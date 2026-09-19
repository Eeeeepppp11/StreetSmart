import { Fragment, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import MapView, { Marker, Polyline } from "react-native-maps";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Speech from "expo-speech";
import { Ionicons } from "@expo/vector-icons";
import { DetectionPipeline, classifyWithModel } from "@potholeproof/detector";
import type { GpsFix } from "@potholeproof/detector";
import {
  AlertBundler,
  DEFAULT_ALERT_SETTINGS,
  phraseForBundle,
  shouldAlert,
  type AlertBundle,
  type AlertMode,
  type AlertSensitivity,
  type AlertSettings,
} from "@potholeproof/alert-settings";
import { upcomingHazards, type ProximityAlert } from "@potholeproof/proximity";
import type { HazardRecord, JoltClassification, JoltEvent, LatLng, SensorSample, Vec3 } from "@potholeproof/shared-types";
import { bearingDegrees, distanceMeters, toHazardCell } from "@potholeproof/geo";
import { chooseRoute, type RouteScore } from "@potholeproof/routing";
import { fetchRouteAlternatives } from "../nav/osrm";
import { reverseGeocode, searchAddress, type GeocodeResult } from "../nav/geocode";
import { cumulativePathMeters, formatDistanceImperial, routeProgress } from "../nav/guidance";
import { hazardsFromJolts } from "../nav/hazards";
import type { NavRoute } from "../nav/types";
import { Badge, Button, Card, IconButton, ScreenHeader, SegmentedControl } from "../components/ui";
import { ReportSheet } from "../components/ReportSheet";
import { classify, classifyHazard, colors, fontFamily, radii, space, typeScale, usePhaseFade } from "../theme";
import { useAuth } from "../auth/AuthContext";
import { useCrowdHazards } from "../hazardMap";
import { fileHazardReport, retractHazardReport, updateHazardReport } from "../hazardReports";
import {
  backdateReportLocation,
  isFixGoodEnough,
  nearestHazard,
  type ReportFix,
} from "../reportFlow";
import { fileMockCivicReport, isEligibleForCivicReport } from "../civicMock";
import { confirmersNeeded } from "@potholeproof/civic";
// import { isWithinVoteRange, VOTE_RADIUS_M } from "../hazardVotes"; // distance gating disabled for now
import { castHazardVote, GONE_VOTES_TO_RETIRE } from "../hazardVotes";
import {
  clearPresence,
  isPresenceStale,
  publishPresence,
  subscribeToLivePresence,
  type LivePresenceDoc,
} from "../livePresence";

/**
 * Live map navigation with hazard-aware routing. Detections here are
 * EPHEMERAL — used to score/reroute this drive and show on-map markers,
 * never saved locally or synced to Firestore. That's what "Survey Roads"
 * (the home screen's other button) is for.
 */

const G = 9.81;
const SENSOR_INTERVAL_MS = 20;
const DRAIN_INTERVAL_MS = 300;
const MODEL_VERSION = "mlp-v1-synthetic";
const ALERT_SETTINGS_KEY = "pp.nav.alertSettings.v1";

const SENSITIVITY_OPTIONS: { value: AlertSensitivity; label: string }[] = [
  { value: "all", label: "All" },
  { value: "moderate", label: "Moderate+" },
  { value: "severe_only", label: "Severe only" },
];
const ALERT_MODE_OPTIONS: { value: AlertMode; label: string }[] = [
  { value: "voice_haptic", label: "Voice + haptic" },
  { value: "haptic_only", label: "Haptic only" },
  { value: "silent", label: "Silent" },
];

type NavPhase = "plan" | "driving" | "settings";

interface ReportToast {
  message: string;
  actions?: { label: string; onPress: () => void }[];
}

interface LiveFix {
  lat: number;
  lng: number;
}

const LIVE_MAP_DELTA = 0.004;
const PLAN_FALLBACK: LatLng = { lat: 37.7749, lng: -122.4194 };
const PLAN_MAP_DELTA = 0.05;
const OFF_ROUTE_METERS = 50;
const OFF_ROUTE_FIXES_BEFORE_REROUTE = 3;
const REROUTE_COOLDOWN_MS = 10_000;
const SPEAK_MANEUVER_METERS = 120;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_QUERY_LENGTH = 3;
const ROAD_SNAP_CONNECTOR_METERS = 20;
const CONNECTOR_DASH_PATTERN = [1, 8];
const ALT_ROUTE_COLOR = colors.neutral.inkSoft;
const HAZARD_BANNER_MS = 6000;
const PRESENCE_PUBLISH_EVERY_N_TICKS = 3;

function needsRoadSnapConnector(point: LatLng | null, onRoute: LatLng | undefined): boolean {
  if (!point || !onRoute) return false;
  return distanceMeters(point, onRoute) > ROAD_SNAP_CONNECTOR_METERS;
}

interface NavigateScreenProps {
  onClose: () => void;
}

export default function NavigateScreen({ onClose }: NavigateScreenProps) {
  const { user } = useAuth();
  const uid = user!.uid;
  const displayName = user!.displayName;

  const [phase, setPhase] = useState<NavPhase>("plan");
  const fade = usePhaseFade(phase);
  const { hazards: crowdHazards, confirmerCounts, goneCounts, myVotes, myReports, pendingIds } = useCrowdHazards(uid);
  const [otherDrivers, setOtherDrivers] = useState<LivePresenceDoc[]>([]);
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  const [hazardBanner, setHazardBanner] = useState<{ text: string } | null>(null);
  const [selectedHazard, setSelectedHazard] = useState<HazardRecord | null>(null);
  const [filingReport, setFilingReport] = useState(false);
  const [events, setEvents] = useState<JoltEvent[]>([]);
  const [speedMps, setSpeedMps] = useState(0);
  const [sampleHz, setSampleHz] = useState(0);
  const [gpsOk, setGpsOk] = useState(false);
  const [liveFix, setLiveFix] = useState<LiveFix | null>(null);

  const [dest, setDest] = useState<LatLng | null>(null);
  const [planCenter, setPlanCenter] = useState<LatLng | null>(null);
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [originQuery, setOriginQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [originSuggestions, setOriginSuggestions] = useState<GeocodeResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<GeocodeResult[]>([]);
  const [activeField, setActiveField] = useState<"origin" | "destination" | null>(null);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [routeOptions, setRouteOptions] = useState<NavRoute[]>([]);
  const [routeScores, setRouteScores] = useState<RouteScore[]>([]);
  const [routeChoice, setRouteChoice] = useState(0);
  const [avoidRough, setAvoidRough] = useState(true);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [navPath, setNavPath] = useState<LatLng[] | null>(null);
  const [navBanner, setNavBanner] = useState<{ text: string; dist: string } | null>(null);
  const [followMe, setFollowMe] = useState(true);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);

  const pipeline = useRef<DetectionPipeline | null>(null);
  const bundler = useRef<AlertBundler | null>(null);
  const alertSettingsRef = useRef<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const liveMap = useRef<MapView | null>(null);
  const planMap = useRef<MapView | null>(null);
  const programmaticRegionChange = useRef(false);
  const buffer = useRef<SensorSample[]>([]);
  const lastGyro = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const originSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const subs = useRef<{ remove: () => void }[]>([]);
  const drainTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const eventsRef = useRef<JoltEvent[]>([]);
  const avoidRoughRef = useRef(true);
  const crowdHazardsRef = useRef<HazardRecord[]>([]);
  const lastFixRef = useRef<LatLng | null>(null);
  /** Latest GPS state for manual reports: position, speed, heading, accuracy. */
  const reportFixRef = useRef<ReportFix | null>(null);
  const [toast, setToast] = useState<ReportToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The just-filed report the "Add details" sheet is editing, if any. */
  const [editingReport, setEditingReport] = useState<{
    id: string;
    classification: JoltClassification;
    severity: number;
  } | null>(null);
  const lastAlertedIdRef = useRef<string | null>(null);
  const presenceTickRef = useRef(0);
  const hazardBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nav = useRef<{
    route: NavRoute;
    cum: number[];
    destination: LatLng;
    spokenStep: number;
    offRouteFixes: number;
    lastRerouteMs: number;
    arrived: boolean;
  } | null>(null);

  useEffect(() => {
    void enterPlan();
    AsyncStorage.getItem(ALERT_SETTINGS_KEY).then((raw) => {
      if (!raw) return;
      const next = { ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(raw) };
      alertSettingsRef.current = next;
      setAlertSettings(next);
    });
    return () => {
      if (drainTimer.current) clearInterval(drainTimer.current);
      for (const s of subs.current) s.remove();
      Speech.stop();
      void clearPresence(uid);
    };
  }, []);

  // GPS callbacks close over this once per startDrive() call, so proximity
  // checks need a ref mirror to see freshly-streamed crowd data mid-drive.
  useEffect(() => {
    crowdHazardsRef.current = crowdHazards;
  }, [crowdHazards]);

  function updateAlertSettings(patch: Partial<AlertSettings>) {
    setAlertSettings((prev) => {
      const next = { ...prev, ...patch };
      alertSettingsRef.current = next;
      void AsyncStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    if (!liveFix || !followMe) return;
    programmaticRegionChange.current = true;
    liveMap.current?.animateToRegion(
      { latitude: liveFix.lat, longitude: liveFix.lng, latitudeDelta: LIVE_MAP_DELTA, longitudeDelta: LIVE_MAP_DELTA },
      650
    );
    const t = setTimeout(() => {
      programmaticRegionChange.current = false;
    }, 700);
    return () => clearTimeout(t);
  }, [liveFix, followMe]);

  useEffect(() => {
    if (!planCenter) return;
    planMap.current?.animateToRegion(
      { latitude: planCenter.lat, longitude: planCenter.lng, latitudeDelta: PLAN_MAP_DELTA, longitudeDelta: PLAN_MAP_DELTA },
      650
    );
  }, [planCenter]);

  useEffect(() => {
    if (routeOptions.length === 0) return;
    const coords = routeOptions
      .flatMap((r) => r.path)
      .map((p) => ({ latitude: p.lat, longitude: p.lng }));
    if (origin) coords.push({ latitude: origin.lat, longitude: origin.lng });
    if (dest) coords.push({ latitude: dest.lat, longitude: dest.lng });
    planMap.current?.fitToCoordinates(coords, {
      edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
      animated: true,
    });
  }, [routeOptions]);

  function handleDrivePanDrag() {
    setFollowMe(false);
  }
  function handleDriveRegionChangeComplete() {
    if (programmaticRegionChange.current) return;
    setFollowMe(false);
  }
  function recenterDriveMap() {
    if (!liveFix) return;
    setFollowMe(true);
    programmaticRegionChange.current = true;
    liveMap.current?.animateToRegion(
      { latitude: liveFix.lat, longitude: liveFix.lng, latitudeDelta: LIVE_MAP_DELTA, longitudeDelta: LIVE_MAP_DELTA },
      500
    );
    setTimeout(() => {
      programmaticRegionChange.current = false;
    }, 550);
  }

  function freshPipeline() {
    pipeline.current = new DetectionPipeline({
      nextId: () => `nav-evt-${Date.now()}-${++seq.current}`,
      modelVersion: MODEL_VERSION,
      classify: classifyWithModel,
    });
    bundler.current = new AlertBundler({ now: () => Date.now() }, alertSettingsRef.current);
    buffer.current = [];
    eventsRef.current = [];
    setEvents([]);
    setSampleHz(0);
    setLiveFix(null);
    setFollowMe(true);
  }

  function addEvents(found: JoltEvent[]) {
    eventsRef.current = [...eventsRef.current, ...found];
    setEvents((prev) => [...prev, ...found]);
  }

  /** Alert (per current mode) for a drained bundle. */
  function announceBundle(bundle: AlertBundle) {
    const mode = alertSettingsRef.current.mode;
    if (mode !== "silent") Vibration.vibrate(150);
    if (mode === "voice_haptic") {
      Speech.stop();
      Speech.speak(phraseForBundle(bundle), { rate: 1.05 });
    }
  }

  /** Same alert-mode rules as announceBundle, for a crowd hazard ahead rather
   *  than something this drive just detected. Shares the nav banner slot. */
  function surfaceProximityAlert(alert: ProximityAlert) {
    const mode = alertSettingsRef.current.mode;
    const text = `${alert.hazard.severityBand} pothole ${alert.side}`;
    if (hazardBannerTimer.current) clearTimeout(hazardBannerTimer.current);
    setHazardBanner({ text });
    hazardBannerTimer.current = setTimeout(() => setHazardBanner(null), HAZARD_BANNER_MS);
    if (mode !== "silent") Vibration.vibrate(150);
    if (mode === "voice_haptic") {
      Speech.stop();
      Speech.speak(text, { rate: 1.05 });
    }
  }

  async function enterPlan() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Location needed", "Navigation routes from your current position.");
      return;
    }
    try {
      const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const loc = { lat: cur.coords.latitude, lng: cur.coords.longitude };
      setPlanCenter(loc);
      setOrigin(loc);
      setOriginQuery("Current location");
      try {
        setOriginQuery(await reverseGeocode(loc));
      } catch {
        // keep "Current location" fallback
      }
    } catch {
      setPlanCenter(PLAN_FALLBACK);
    }
  }

  async function fetchRoutesTo(from: LatLng | null, destination: LatLng) {
    if (!from) {
      setRouteError("Set a starting point first.");
      return;
    }
    setRouteBusy(true);
    setRouteError(null);
    setRouteOptions([]);
    setRouteScores([]);
    try {
      const routes = await fetchRouteAlternatives(from, destination);
      const { index, scores } = chooseRoute(
        routes.map((r) => r.path),
        [...hazardsFromJolts(eventsRef.current), ...crowdHazardsRef.current],
        { avoidSevereRoadDamage: avoidRoughRef.current }
      );
      setRouteOptions(routes);
      setRouteScores(scores);
      setRouteChoice(index);
    } catch {
      setRouteError("Couldn't fetch a route — check your connection and try again.");
    } finally {
      setRouteBusy(false);
    }
  }

  async function runSearch(query: string, field: "origin" | "destination") {
    const trimmed = query.trim();
    if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
      if (field === "origin") setOriginSuggestions([]);
      else setDestSuggestions([]);
      return;
    }
    try {
      const results = await searchAddress(trimmed);
      if (field === "origin") setOriginSuggestions(results);
      else setDestSuggestions(results);
      setGeocodeError(null);
    } catch {
      if (field === "origin") setOriginSuggestions([]);
      else setDestSuggestions([]);
      setGeocodeError("Couldn't search — check your connection and try again.");
    }
  }

  function onOriginQueryChange(text: string) {
    setOriginQuery(text);
    setActiveField("origin");
    if (originSearchTimer.current) clearTimeout(originSearchTimer.current);
    originSearchTimer.current = setTimeout(() => void runSearch(text, "origin"), SEARCH_DEBOUNCE_MS);
  }
  function onDestQueryChange(text: string) {
    setDestQuery(text);
    setActiveField("destination");
    if (destSearchTimer.current) clearTimeout(destSearchTimer.current);
    destSearchTimer.current = setTimeout(() => void runSearch(text, "destination"), SEARCH_DEBOUNCE_MS);
  }
  function selectOrigin(result: GeocodeResult) {
    setOrigin(result.location);
    setOriginQuery(result.label);
    setOriginSuggestions([]);
    setActiveField(null);
    if (dest) void fetchRoutesTo(result.location, dest);
  }
  function selectDestination(result: GeocodeResult) {
    setDest(result.location);
    setDestQuery(result.label);
    setDestSuggestions([]);
    setActiveField(null);
    void fetchRoutesTo(origin, result.location);
  }

  async function handleMapTap(loc: LatLng) {
    const field: "origin" | "destination" = activeField ?? (origin === null ? "origin" : "destination");
    if (field === "origin") {
      setOrigin(loc);
      setOriginQuery("Pinned location");
      setOriginSuggestions([]);
    } else {
      setDest(loc);
      setDestQuery("Pinned location");
      setDestSuggestions([]);
    }
    setActiveField(null);
    try {
      const label = await reverseGeocode(loc);
      if (field === "origin") setOriginQuery(label);
      else setDestQuery(label);
    } catch {
      // keep "Pinned location" fallback
    }
    if (field === "destination") void fetchRoutesTo(origin, loc);
    else if (dest) void fetchRoutesTo(loc, dest);
  }

  function rechoose(avoid: boolean) {
    if (routeOptions.length === 0) return;
    const { index } = chooseRoute(
      routeOptions.map((r) => r.path),
      [...hazardsFromJolts(eventsRef.current), ...crowdHazardsRef.current],
      { avoidSevereRoadDamage: avoid }
    );
    setRouteChoice(index);
  }

  function handleNavFix(fix: GpsFix) {
    const n = nav.current;
    if (!n || n.arrived) return;
    const p = routeProgress(n.route, n.cum, fix.location);
    if (p.arrived) {
      n.arrived = true;
      setNavBanner({ text: "You've arrived at your destination", dist: "" });
      if (alertSettingsRef.current.mode === "voice_haptic") {
        Speech.speak("You have arrived at your destination.", { rate: 1.05 });
      }
      return;
    }
    const step = n.route.steps[p.nextStepIndex];
    if (step) {
      setNavBanner({ text: step.instruction, dist: formatDistanceImperial(p.metersToNextManeuver) });
      if (
        alertSettingsRef.current.mode === "voice_haptic" &&
        p.metersToNextManeuver <= SPEAK_MANEUVER_METERS &&
        n.spokenStep !== p.nextStepIndex
      ) {
        n.spokenStep = p.nextStepIndex;
        const phrase =
          p.metersToNextManeuver < 30
            ? step.instruction
            : `In ${formatDistanceImperial(p.metersToNextManeuver)}, ${step.instruction}`;
        Speech.speak(phrase, { rate: 1.05 });
      }
    }
    n.offRouteFixes = p.offRouteMeters > OFF_ROUTE_METERS ? n.offRouteFixes + 1 : 0;
    if (n.offRouteFixes >= OFF_ROUTE_FIXES_BEFORE_REROUTE && Date.now() - n.lastRerouteMs > REROUTE_COOLDOWN_MS) {
      n.lastRerouteMs = Date.now();
      n.offRouteFixes = 0;
      void reroute(fix.location);
    }
  }

  async function reroute(from: LatLng) {
    const n = nav.current;
    if (!n) return;
    setNavBanner({ text: "Rerouting…", dist: "" });
    try {
      const routes = await fetchRouteAlternatives(from, n.destination);
      if (routes.length === 0 || !nav.current) return;
      const { index } = chooseRoute(
        routes.map((r) => r.path),
        [...hazardsFromJolts(eventsRef.current), ...crowdHazardsRef.current],
        { avoidSevereRoadDamage: avoidRoughRef.current }
      );
      const next = routes[index]!;
      nav.current = { ...nav.current, route: next, cum: cumulativePathMeters(next.path), spokenStep: -1 };
      setNavPath(next.path);
    } catch {
      // keep guiding on the old route; the next off-route streak retries
    }
  }

  async function startDrive(navRoute?: NavRoute) {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Location needed", "Without location, navigation and detection can't run.");
      return;
    }
    freshPipeline();
    setGpsOk(false);

    if (navRoute && dest) {
      nav.current = {
        route: navRoute,
        cum: cumulativePathMeters(navRoute.path),
        destination: dest,
        spokenStep: -1,
        offRouteFixes: 0,
        lastRerouteMs: 0,
        arrived: false,
      };
      setNavPath(navRoute.path);
      const first = navRoute.steps[0];
      setNavBanner(first ? { text: first.instruction, dist: "" } : null);
    } else {
      nav.current = null;
      setNavPath(null);
      setNavBanner(null);
    }

    lastFixRef.current = null;
    lastAlertedIdRef.current = null;
    presenceTickRef.current = 0;
    subs.current.push({ remove: subscribeToLivePresence(setOtherDrivers) });

    Gyroscope.setUpdateInterval(SENSOR_INTERVAL_MS);
    Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
    subs.current.push(Gyroscope.addListener((g) => { lastGyro.current = { x: g.x, y: g.y, z: g.z }; }));
    subs.current.push(
      Accelerometer.addListener((a) => {
        buffer.current.push({ t: Date.now(), accel: { x: a.x * G, y: a.y * G, z: a.z * G }, gyro: lastGyro.current });
      })
    );
    subs.current.push(
      await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (loc) => {
          const heading = loc.coords.heading;
          const fix: GpsFix = {
            t: loc.timestamp,
            capturedAt: new Date(loc.timestamp).toISOString(),
            location: { lat: loc.coords.latitude, lng: loc.coords.longitude },
            speedMps: Math.max(0, loc.coords.speed ?? 0),
            ...(heading !== null && heading >= 0 ? { heading } : {}),
          };
          pipeline.current?.pushGps(fix);
          setGpsOk(true);
          setSpeedMps(Math.max(0, loc.coords.speed ?? 0));
          setLiveFix({ lat: fix.location.lat, lng: fix.location.lng });
          handleNavFix(fix);

          // Proximity: derive heading from the last fix when the device
          // doesn't report one (only unavailable on the very first tick).
          const headingDeg = fix.heading ?? (lastFixRef.current ? bearingDegrees(lastFixRef.current, fix.location) : null);
          lastFixRef.current = fix.location;
          reportFixRef.current = {
            location: fix.location,
            speedMps: fix.speedMps,
            heading: headingDeg,
            accuracy: loc.coords.accuracy ?? null,
          };
          if (headingDeg !== null) {
            const alerts = upcomingHazards(
              { position: fix.location, headingDegrees: headingDeg, speedMps: fix.speedMps },
              crowdHazardsRef.current
            );
            if (alerts[0] && alerts[0].hazard.id !== lastAlertedIdRef.current) {
              lastAlertedIdRef.current = alerts[0].hazard.id;
              surfaceProximityAlert(alerts[0]);
            }
          }

          // Live presence, throttled — not every tick.
          presenceTickRef.current += 1;
          if (presenceTickRef.current % PRESENCE_PUBLISH_EVERY_N_TICKS === 0) {
            void publishPresence(uid, displayName, fix);
          }
        }
      )
    );

    drainTimer.current = setInterval(() => {
      const batch = buffer.current.splice(0);
      setSampleHz(Math.round((batch.length * 1000) / DRAIN_INTERVAL_MS));
      const found = pipeline.current?.push(batch) ?? [];
      if (found.length > 0) {
        addEvents(found);
        for (const e of found) {
          if (shouldAlert(e, alertSettingsRef.current)) bundler.current?.add(e);
        }
      }
      const bundle = bundler.current?.drain();
      if (bundle) announceBundle(bundle);
    }, DRAIN_INTERVAL_MS);

    setPhase("driving");
  }

  function stopDrive() {
    if (drainTimer.current) clearInterval(drainTimer.current);
    drainTimer.current = null;
    if (hazardBannerTimer.current) clearTimeout(hazardBannerTimer.current);
    for (const s of subs.current) s.remove();
    subs.current = [];
    pipeline.current?.flush();
    pipeline.current = null;
    bundler.current = null;
    Speech.stop();
    void clearPresence(uid);
    setOtherDrivers([]);
    setHazardBanner(null);
    nav.current = null;
    setNavPath(null);
    setNavBanner(null);
    setPhase("plan");
    void enterPlan();
  }

  function showToast(next: ReportToast | null, ms = 6000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    if (next) toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  /** File a new manual report at `location`, then offer Add details / Undo. */
  async function fileQuickReport(location: LatLng, classification: JoltClassification, severity: number) {
    try {
      const result = await fileHazardReport(uid, null, location, classification, severity);
      if (result.status === "duplicate") {
        showToast({ message: "You already reported this spot today." });
        return;
      }
      showToast({
        message: "Pothole reported",
        actions: [
          {
            label: "Add details",
            onPress: () => {
              setEditingReport({ id: result.id, classification, severity });
              setReportSheetVisible(true);
              showToast(null);
            },
          },
          {
            label: "Undo",
            onPress: () => {
              void retractHazardReport(result.id);
              showToast({ message: "Report removed" }, 3000);
            },
          },
        ],
      });
    } catch {
      showToast({ message: "Couldn't send the report — check your connection." });
    }
  }

  /** One tap: a moderate pothole at the back-dated location. If a known hazard
   *  is already right there, ask whether this is it and confirm instead. */
  function quickReport() {
    const fix = reportFixRef.current;
    if (!fix) return;
    if (!isFixGoodEnough(fix)) {
      showToast({ message: "GPS signal is weak — try again in a moment." });
      return;
    }
    const location = backdateReportLocation(fix);
    const nearby = nearestHazard(crowdHazards, location);
    if (nearby && myVotes[nearby.id] !== "confirm") {
      showToast(
        {
          message: "Is this the pothole ahead?",
          actions: [
            {
              label: "Yes, confirm it",
              onPress: () => {
                void castHazardVote(nearby, uid, "confirm");
                showToast({ message: "Confirmed — thanks" }, 3000);
              },
            },
            { label: "No, new one", onPress: () => void fileQuickReport(location, "pothole", 0.5) },
          ],
        },
        9000
      );
      return;
    }
    void fileQuickReport(location, "pothole", 0.5);
  }

  const [voting, setVoting] = useState(false);
  async function voteOnSelectedHazard(vote: "confirm" | "gone") {
    if (!selectedHazard) return;
    setVoting(true);
    try {
      // Tapping your current vote again retracts it.
      await castHazardVote(selectedHazard, uid, myVotes[selectedHazard.id] === vote ? "none" : vote);
    } finally {
      setVoting(false);
    }
  }

  async function reportSelectedHazardToCity() {
    if (!selectedHazard) return;
    setFilingReport(true);
    try {
      await fileMockCivicReport(selectedHazard, uid);
    } finally {
      setFilingReport(false);
    }
  }

  const chosen: NavRoute | undefined = routeOptions[routeChoice];
  const center = planCenter ?? PLAN_FALLBACK;

  if (phase === "driving") {
    return (
      <Animated.View style={[styles.screen, styles.driveScreen, { opacity: fade }]}>
        <StatusBar style="light" />
        <View style={styles.driveHud}>
          <View style={styles.driveHudCell}>
            <Text style={styles.driveSpeed}>
              {(speedMps * 2.237).toFixed(0)}
              <Text style={styles.driveSpeedUnit}> mph</Text>
            </Text>
            <Text style={styles.driveStat}>sensors {sampleHz} Hz · GPS {gpsOk ? "✓" : "…"}</Text>
          </View>
          <View style={[styles.driveHudCell, styles.driveHudCellRight]}>
            <Text style={styles.driveCount}>{events.length}</Text>
            <Text style={styles.driveStat}>jolt{events.length === 1 ? "" : "s"} detected</Text>
          </View>
        </View>
        {(navBanner || hazardBanner) && (
          <View style={styles.navBanner}>
            {navBanner ? (
              <Fragment>
                {navBanner.dist !== "" && <Text style={styles.navBannerDist}>{navBanner.dist}</Text>}
                <Text style={styles.navBannerText}>{navBanner.text}</Text>
              </Fragment>
            ) : (
              <Text style={styles.navBannerText}>{hazardBanner!.text}</Text>
            )}
          </View>
        )}
        <View style={styles.liveMapWrap}>
          {liveFix ? (
            <MapView
              ref={liveMap}
              style={styles.liveMap}
              initialRegion={{
                latitude: liveFix.lat,
                longitude: liveFix.lng,
                latitudeDelta: LIVE_MAP_DELTA,
                longitudeDelta: LIVE_MAP_DELTA,
              }}
              scrollEnabled
              zoomEnabled
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              onPanDrag={handleDrivePanDrag}
              onRegionChangeComplete={handleDriveRegionChangeComplete}
            >
              <Marker coordinate={{ latitude: liveFix.lat, longitude: liveFix.lng }} anchor={{ x: 0.5, y: 0.5 }} flat>
                <View style={styles.carDot} />
              </Marker>
              {navPath && navPath.length > 1 && (
                <Fragment>
                  <Polyline
                    coordinates={navPath.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
                    strokeColor={colors.status.info}
                    strokeWidth={5}
                  />
                  {needsRoadSnapConnector(liveFix, navPath[0]) && (
                    <Polyline
                      coordinates={[
                        { latitude: liveFix.lat, longitude: liveFix.lng },
                        { latitude: navPath[0]!.lat, longitude: navPath[0]!.lng },
                      ]}
                      strokeColor={colors.status.info}
                      strokeWidth={3}
                      lineDashPattern={CONNECTOR_DASH_PATTERN}
                    />
                  )}
                </Fragment>
              )}
              {navPath && dest && (
                <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} pinColor={colors.status.success} title="Destination" />
              )}
              {events.map((e) => (
                <Marker key={e.id} coordinate={{ latitude: e.location.lat, longitude: e.location.lng }} pinColor={classify(e).color} />
              ))}
              {crowdHazards.map((h) => (
                <Marker
                  key={h.id}
                  coordinate={{ latitude: h.location.lat, longitude: h.location.lng }}
                  pinColor={classifyHazard(h).color}
                  opacity={0.75}
                  onPress={() => setSelectedHazard(h)}
                />
              ))}
              {otherDrivers
                .filter((d) => d.uid !== uid && !isPresenceStale(d))
                .map((d) => (
                  <Marker
                    key={d.uid}
                    coordinate={{ latitude: d.location.lat, longitude: d.location.lng }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    flat
                    rotation={d.headingDegrees ?? 0}
                  >
                    <View style={styles.otherDriverDot} />
                  </Marker>
                ))}
            </MapView>
          ) : (
            <View style={styles.liveMapWaiting}>
              <ActivityIndicator size="small" color={colors.neutral.inkFaint} />
              <Text style={[styles.driveStat, styles.waitingText]}>waiting for GPS fix…</Text>
            </View>
          )}
          {liveFix && !followMe && (
            <View style={styles.recenterWrap}>
              <IconButton icon="locate" variant="floating" onPress={recenterDriveMap} accessibilityLabel="Recenter map" />
            </View>
          )}
          {liveFix && (
            <View style={styles.reportWrap}>
              <IconButton icon="add-circle" variant="floating" onPress={quickReport} accessibilityLabel="Report pothole" />
            </View>
          )}
          {selectedHazard && (
            <Card style={styles.hazardDetailCard}>
              <View style={styles.hazardDetailHeaderRow}>
                <Badge {...classifyHazard(selectedHazard)} />
                <IconButton icon="close" onPress={() => setSelectedHazard(null)} accessibilityLabel="Close" />
              </View>
              {(() => {
                const confirmers = confirmerCounts[selectedHazard.id] ?? 0;
                const gone = goneCounts[selectedHazard.id] ?? 0;
                const needed = confirmersNeeded(selectedHazard);
                const myVote = myVotes[selectedHazard.id];
                // Distance gating temporarily disabled for testing.
                // const inRange = !!liveFix && isWithinVoteRange(selectedHazard, { lat: liveFix.lat, lng: liveFix.lng });
                const inRange = true;
                return (
                  <>
                    <Text style={styles.hazardDetailMeta}>
                      {confirmers} driver{confirmers === 1 ? "" : "s"} confirmed ·{" "}
                      {Math.round(selectedHazard.confidence * 100)}% confidence
                      {pendingIds.has(selectedHazard.id) ? " · pending, needs one more driver" : ""}
                      {gone > 0 ? ` · ${gone}/${GONE_VOTES_TO_RETIRE} say it's gone` : ""}
                    </Text>
                    <View style={styles.voteRow}>
                      <Button
                        label={myVote === "confirm" ? "Confirmed · undo" : "Still there"}
                        onPress={() => voteOnSelectedHazard("confirm")}
                        disabled={!inRange || voting}
                        variant={myVote === "confirm" ? "primary" : "outline"}
                        size="sm"
                        icon="checkmark-circle-outline"
                        style={styles.voteBtn}
                      />
                      <Button
                        label={myVote === "gone" ? "Marked gone · undo" : "Not there / fixed"}
                        onPress={() => voteOnSelectedHazard("gone")}
                        disabled={!inRange || voting}
                        variant={myVote === "gone" ? "primary" : "outline"}
                        size="sm"
                        icon="close-circle-outline"
                        style={styles.voteBtn}
                      />
                    </View>
                    {myReports[selectedHazard.id] && (
                      <Button
                        label="Retract my report"
                        onPress={() => {
                          void retractHazardReport(myReports[selectedHazard.id]!);
                          setSelectedHazard(null);
                        }}
                        variant="outline"
                        size="sm"
                        icon="arrow-undo-outline"
                        style={styles.hazardDetailBtn}
                      />
                    )}
                    {selectedHazard.status === "reported" ? (
                      <Text style={styles.hazardDetailMeta}>Already reported to the city.</Text>
                    ) : isEligibleForCivicReport(selectedHazard, confirmers) ? (
                      <Button
                        label="Report to city"
                        onPress={reportSelectedHazardToCity}
                        loading={filingReport}
                        variant="outline"
                        size="sm"
                        icon="megaphone-outline"
                        style={styles.hazardDetailBtn}
                      />
                    ) : (
                      <Text style={styles.hazardDetailMeta}>
                        {confirmers}/{needed} confirmations needed to report to the city.
                      </Text>
                    )}
                  </>
                );
              })()}
            </Card>
          )}
        </View>
        <Button label="End navigation" onPress={stopDrive} variant="danger" size="lg" icon="close-circle-outline" style={styles.stopBtnMargin} />
        {toast && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast.message}</Text>
            <View style={styles.toastActions}>
              {toast.actions?.map((a) => (
                <Pressable key={a.label} onPress={a.onPress} hitSlop={8}>
                  <Text style={styles.toastAction}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <ReportSheet
          visible={reportSheetVisible}
          onClose={() => {
            setReportSheetVisible(false);
            setEditingReport(null);
          }}
          title="Add details"
          submitLabel="Save"
          initial={editingReport ?? undefined}
          onSubmit={(classification, severity) => {
            if (!editingReport) return;
            void updateHazardReport(editingReport.id, { classification, severity });
            showToast({ message: "Report updated" }, 3000);
          }}
        />
      </Animated.View>
    );
  }

  if (phase === "settings") {
    return (
      <Animated.View style={[styles.screen, styles.planScreen, { opacity: fade }]}>
        <StatusBar style="dark" />
        <ScrollView showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Alert settings" onBack={() => setPhase("plan")} />

          <Card style={styles.settingsCardMargin}>
            <Text style={styles.settingsLabel}>Sensitivity</Text>
            <SegmentedControl
              options={SENSITIVITY_OPTIONS}
              value={alertSettings.sensitivity}
              onChange={(v) => updateAlertSettings({ sensitivity: v })}
            />
            <Text style={[styles.settingsLabel, styles.settingsLabelSpaced]}>Alert mode</Text>
            <SegmentedControl
              options={ALERT_MODE_OPTIONS}
              value={alertSettings.mode}
              onChange={(v) => updateAlertSettings({ mode: v })}
            />
          </Card>

          <Card style={styles.settingsCardMargin}>
            <Text style={typeScale.label}>Privacy</Text>
            <Text style={styles.privacyText}>
              Detections during navigation are ephemeral — used only to score routes and show on-map markers for this
              drive, never saved locally or synced to the cloud. Choosing a destination sends only that route
              request&apos;s start and end points to the routing/geocoding services — never your track, never an
              identifier.
            </Text>
          </Card>
        </ScrollView>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.screen, styles.planScreen, { opacity: fade }]}>
      <StatusBar style="dark" />
      <View style={styles.homeTopRow}>
        <View style={styles.homeHeaderText}>
          <Text style={typeScale.h1}>Navigate</Text>
          <Text style={styles.planHint}>
            {dest ? "Tap a route to choose it." : planCenter ? "Search for a destination, or tap the map." : "Finding your location…"}
          </Text>
        </View>
        <IconButton icon="settings-outline" onPress={() => setPhase("settings")} accessibilityLabel="Alert settings" />
        <IconButton icon="close" onPress={onClose} accessibilityLabel="Close" />
      </View>

      <View style={styles.searchFieldWrap}>
        <View style={[styles.searchInputRow, activeField === "origin" && styles.searchInputRowActive]}>
          <Ionicons name="search-outline" size={16} color={colors.neutral.inkFaint} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={originQuery}
            placeholder="Choose starting point, or tap on the map"
            placeholderTextColor={colors.neutral.inkFaint}
            onFocus={() => setActiveField("origin")}
            onChangeText={onOriginQueryChange}
            returnKeyType="search"
          />
        </View>
        {activeField === "origin" && originSuggestions.length > 0 && (
          <View style={styles.suggestionList}>
            <ScrollView keyboardShouldPersistTaps="handled">
              {originSuggestions.map((s, i) => (
                <Pressable key={`o-${i}`} style={styles.suggestionRow} onPress={() => selectOrigin(s)}>
                  <Text style={styles.suggestionRowText}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      <View style={styles.searchFieldWrap}>
        <View style={[styles.searchInputRow, activeField === "destination" && styles.searchInputRowActive]}>
          <Ionicons name="search-outline" size={16} color={colors.neutral.inkFaint} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={destQuery}
            placeholder="Destination address, or tap on the map"
            placeholderTextColor={colors.neutral.inkFaint}
            onFocus={() => setActiveField("destination")}
            onChangeText={onDestQueryChange}
            returnKeyType="search"
          />
        </View>
        {activeField === "destination" && destSuggestions.length > 0 && (
          <View style={styles.suggestionList}>
            <ScrollView keyboardShouldPersistTaps="handled">
              {destSuggestions.map((s, i) => (
                <Pressable key={`d-${i}`} style={styles.suggestionRow} onPress={() => selectDestination(s)}>
                  <Text style={styles.suggestionRowText}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
      {geocodeError && <Text style={styles.planError}>{geocodeError}</Text>}

      <View style={styles.planMapWrap}>
        <MapView
          ref={planMap}
          style={{ flex: 1 }}
          initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: PLAN_MAP_DELTA, longitudeDelta: PLAN_MAP_DELTA }}
          showsUserLocation
          onPress={(e) => {
            const c = e.nativeEvent.coordinate;
            void handleMapTap({ lat: c.latitude, lng: c.longitude });
          }}
        >
          {routeOptions.map((r, i) => {
            const routeColor = i === routeChoice ? colors.status.info : ALT_ROUTE_COLOR;
            const start = r.path[0];
            const end = r.path[r.path.length - 1];
            return (
              <Fragment key={`route-${i}`}>
                <Polyline
                  coordinates={r.path.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
                  strokeColor={routeColor}
                  strokeWidth={i === routeChoice ? 5 : 3}
                  tappable
                  onPress={() => setRouteChoice(i)}
                />
                {needsRoadSnapConnector(origin, start) && (
                  <Polyline
                    coordinates={[
                      { latitude: origin!.lat, longitude: origin!.lng },
                      { latitude: start!.lat, longitude: start!.lng },
                    ]}
                    strokeColor={routeColor}
                    strokeWidth={3}
                    lineDashPattern={CONNECTOR_DASH_PATTERN}
                  />
                )}
                {needsRoadSnapConnector(dest, end) && (
                  <Polyline
                    coordinates={[
                      { latitude: end!.lat, longitude: end!.lng },
                      { latitude: dest!.lat, longitude: dest!.lng },
                    ]}
                    strokeColor={routeColor}
                    strokeWidth={3}
                    lineDashPattern={CONNECTOR_DASH_PATTERN}
                  />
                )}
              </Fragment>
            );
          })}
          {origin && <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} pinColor={colors.status.info} title="Start" />}
          {dest && <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} pinColor={colors.status.success} title="Destination" />}
          {crowdHazards.map((h) => (
            <Marker
              key={h.id}
              coordinate={{ latitude: h.location.lat, longitude: h.location.lng }}
              pinColor={classifyHazard(h).color}
              opacity={0.75}
              title={classifyHazard(h).label}
            />
          ))}
        </MapView>
      </View>
      {routeBusy && (
        <View style={styles.planStatusRow}>
          <ActivityIndicator size="small" color={colors.neutral.inkSoft} />
          <Text style={styles.planStatus}>finding routes…</Text>
        </View>
      )}
      {routeError && <Text style={styles.planError}>{routeError}</Text>}
      {routeOptions.length > 0 && (
        <View style={styles.routeChips}>
          {routeOptions.map((r, i) => {
            const score = routeScores[i];
            const active = i === routeChoice;
            return (
              <Pressable key={`chip-${i}`} style={[styles.routeChip, active && styles.routeChipActive]} onPress={() => setRouteChoice(i)}>
                <View style={styles.routeChipTitleRow}>
                  <Ionicons name="time-outline" size={13} color={active ? colors.status.info : colors.neutral.ink} />
                  <Text style={[styles.routeChipTitle, active && styles.routeChipTitleActive]}>
                    {Math.round(r.durationSeconds / 60)} min · {(r.distanceMeters / 1609.34).toFixed(1)} mi
                  </Text>
                </View>
                {score && score.hazardExposureScore > 0 && (
                  <View style={styles.routeChipMetaRow}>
                    <Ionicons name="warning-outline" size={11} color={colors.neutral.inkFaint} />
                    <Text style={styles.routeChipMeta}>rough-road exposure {Math.round(score.hazardExposureScore * 100)}%</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
      <Card style={styles.planToggleCard}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextWrap}>
            <Text style={styles.toggleLabel}>Avoid rough roads</Text>
            <Text style={styles.toggleDescription}>Prefers routes away from hazards detected this session.</Text>
          </View>
          <Switch
            value={avoidRough}
            trackColor={{ true: colors.brand.primary }}
            onValueChange={(v) => {
              setAvoidRough(v);
              avoidRoughRef.current = v;
              rechoose(v);
            }}
          />
        </View>
      </Card>
      <Button
        label={chosen ? "Start navigation" : "Start drive"}
        onPress={() => (chosen ? void startDrive(chosen) : void startDrive())}
        variant="primary"
        size="lg"
        icon="navigate"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.bg, paddingTop: 56, paddingHorizontal: space.lg },
  driveScreen: { backgroundColor: colors.dark.bg, paddingHorizontal: 0 },
  planScreen: {},
  homeTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.xs, marginBottom: space.md },
  homeHeaderText: { flex: 1 },
  planHint: { fontFamily: fontFamily.body, fontSize: 14, color: colors.neutral.inkSoft, marginTop: 4 },
  settingsCardMargin: { marginTop: space.lg },
  settingsLabel: { fontFamily: fontFamily.bodyBold, fontSize: 14, color: colors.neutral.ink, marginBottom: space.sm },
  settingsLabelSpaced: { marginTop: space.lg },
  privacyText: { fontFamily: fontFamily.body, fontSize: 13, color: colors.neutral.inkSoft, lineHeight: 19, marginTop: space.sm },
  searchFieldWrap: { marginBottom: space.sm, zIndex: 5 },
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.neutral.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.neutral.border,
    paddingHorizontal: space.md,
  },
  searchInputRowActive: { borderColor: colors.status.info },
  searchIcon: { marginRight: space.sm },
  searchInput: { flex: 1, paddingVertical: 12, fontFamily: fontFamily.body, fontSize: 15, color: colors.neutral.ink },
  suggestionList: {
    backgroundColor: colors.neutral.surface,
    borderRadius: radii.sm,
    marginTop: 4,
    maxHeight: 180,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  suggestionRow: { paddingVertical: 10, paddingHorizontal: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.neutral.divider },
  suggestionRowText: { fontFamily: fontFamily.body, fontSize: 14, color: colors.neutral.ink },
  planError: { color: colors.status.danger, fontFamily: fontFamily.bodyMedium, fontSize: 13, marginBottom: space.xs },
  planStatusRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs },
  planStatus: { color: colors.neutral.inkSoft, fontFamily: fontFamily.bodyMedium, fontSize: 13 },
  planMapWrap: { flex: 1, borderRadius: radii.md, overflow: "hidden", marginVertical: space.sm, minHeight: 220 },
  routeChips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.sm },
  routeChip: { borderWidth: 1, borderColor: colors.neutral.border, borderRadius: radii.sm, paddingVertical: space.sm, paddingHorizontal: space.md, backgroundColor: colors.neutral.surface },
  routeChipActive: { borderColor: colors.status.info, backgroundColor: colors.status.infoTint },
  routeChipTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  routeChipTitle: { fontFamily: fontFamily.bodyBold, fontSize: 13, color: colors.neutral.ink },
  routeChipTitleActive: { color: colors.status.info },
  routeChipMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  routeChipMeta: { fontFamily: fontFamily.bodyMedium, fontSize: 11, color: colors.neutral.inkFaint },
  planToggleCard: { marginBottom: space.md },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  toggleTextWrap: { flex: 1 },
  toggleLabel: { fontFamily: fontFamily.bodyBold, fontSize: 14, color: colors.neutral.ink },
  toggleDescription: { fontFamily: fontFamily.body, fontSize: 12, color: colors.neutral.inkFaint, marginTop: 2 },
  driveHud: { flexDirection: "row", paddingTop: space.md, paddingHorizontal: space.xl },
  driveHudCell: { flex: 1 },
  driveHudCellRight: { alignItems: "flex-end" },
  driveSpeed: { fontFamily: fontFamily.mono, fontSize: 48, color: colors.white },
  driveSpeedUnit: { fontFamily: fontFamily.body, fontSize: 16, color: colors.neutral.inkFaint },
  driveStat: { fontFamily: fontFamily.bodyMedium, fontSize: 12, color: colors.neutral.inkFaint, marginTop: 2 },
  waitingText: { marginTop: space.sm },
  driveCount: { fontFamily: fontFamily.mono, fontSize: 40, color: colors.brand.primary },
  navBanner: { backgroundColor: colors.neutral.ink, marginHorizontal: space.lg, marginTop: space.sm, borderRadius: radii.md, padding: space.md },
  navBannerDist: { color: "#8fb4f5", fontFamily: fontFamily.bodyBold, fontSize: 13 },
  navBannerText: { color: colors.white, fontFamily: fontFamily.bodyBold, fontSize: 17, marginTop: 2 },
  liveMapWrap: { flex: 1, marginTop: space.md },
  liveMap: { flex: 1 },
  liveMapWaiting: { flex: 1, alignItems: "center", justifyContent: "center" },
  carDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.status.info, borderWidth: 3, borderColor: colors.white },
  otherDriverDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.neutral.ink, borderWidth: 2, borderColor: colors.white },
  recenterWrap: { position: "absolute", right: space.lg, bottom: space.lg },
  reportWrap: { position: "absolute", left: space.lg, bottom: space.lg },
  hazardDetailCard: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  hazardDetailHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hazardDetailMeta: { fontFamily: fontFamily.bodyMedium, fontSize: 12, color: colors.neutral.inkSoft, marginTop: space.sm },
  hazardDetailBtn: { marginTop: space.sm },
  toast: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    bottom: 96,
    padding: space.md,
    borderRadius: radii.md,
    backgroundColor: colors.neutral.ink,
  },
  toastText: { fontFamily: fontFamily.bodySemibold, fontSize: 14, color: colors.white },
  toastActions: { flexDirection: "row", gap: space.lg, marginTop: space.sm },
  toastAction: { fontFamily: fontFamily.bodyBold, fontSize: 14, color: colors.brand.primary },
  voteRow: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  voteBtn: { flex: 1 },
  stopBtnMargin: { marginHorizontal: space.lg, marginVertical: space.lg },
});
