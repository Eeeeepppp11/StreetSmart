import { Fragment, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import type { JoltEvent, LatLng, SensorSample, Vec3 } from "@potholeproof/shared-types";
import { distanceMeters } from "@potholeproof/geo";
import { chooseRoute, type RouteScore } from "@potholeproof/routing";
import { fetchRouteAlternatives } from "../nav/osrm";
import { reverseGeocode, searchAddress, type GeocodeResult } from "../nav/geocode";
import { cumulativePathMeters, formatDistanceImperial, routeProgress } from "../nav/guidance";
import { hazardsFromJolts } from "../nav/hazards";
import type { NavRoute } from "../nav/types";

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
  { value: "voice_haptic", label: "Voice + Haptic" },
  { value: "haptic_only", label: "Haptic only" },
  { value: "silent", label: "Silent" },
];

type NavPhase = "plan" | "driving" | "settings";

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

function pinColor(e: JoltEvent): string {
  if (e.classification === "pothole") {
    return e.severity >= 0.67 ? "#d92616" : e.severity >= 0.34 ? "#e8812e" : "#e6b91e";
  }
  if (e.classification === "speed_bump") return "#4a72da";
  return "#8a939d";
}

function needsRoadSnapConnector(point: LatLng | null, onRoute: LatLng | undefined): boolean {
  if (!point || !onRoute) return false;
  return distanceMeters(point, onRoute) > ROAD_SNAP_CONNECTOR_METERS;
}

interface NavigateScreenProps {
  onClose: () => void;
}

export default function NavigateScreen({ onClose }: NavigateScreenProps) {
  const [phase, setPhase] = useState<NavPhase>("plan");
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
    };
  }, []);

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
        hazardsFromJolts(eventsRef.current),
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
      hazardsFromJolts(eventsRef.current),
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
        hazardsFromJolts(eventsRef.current),
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
    for (const s of subs.current) s.remove();
    subs.current = [];
    pipeline.current?.flush();
    pipeline.current = null;
    bundler.current = null;
    Speech.stop();
    nav.current = null;
    setNavPath(null);
    setNavBanner(null);
    setPhase("plan");
    void enterPlan();
  }

  const chosen: NavRoute | undefined = routeOptions[routeChoice];
  const center = planCenter ?? PLAN_FALLBACK;

  if (phase === "driving") {
    return (
      <View style={[styles.screen, styles.driveScreen]}>
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
        {navBanner && (
          <View style={styles.navBanner}>
            {navBanner.dist !== "" && <Text style={styles.navBannerDist}>{navBanner.dist}</Text>}
            <Text style={styles.navBannerText}>{navBanner.text}</Text>
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
                <>
                  <Polyline
                    coordinates={navPath.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
                    strokeColor="#1f6fe8"
                    strokeWidth={5}
                  />
                  {needsRoadSnapConnector(liveFix, navPath[0]) && (
                    <Polyline
                      coordinates={[
                        { latitude: liveFix.lat, longitude: liveFix.lng },
                        { latitude: navPath[0]!.lat, longitude: navPath[0]!.lng },
                      ]}
                      strokeColor="#1f6fe8"
                      strokeWidth={3}
                      lineDashPattern={CONNECTOR_DASH_PATTERN}
                    />
                  )}
                </>
              )}
              {navPath && dest && (
                <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} pinColor="#1a7f37" title="Destination" />
              )}
              {events.map((e) => (
                <Marker key={e.id} coordinate={{ latitude: e.location.lat, longitude: e.location.lng }} pinColor={pinColor(e)} />
              ))}
            </MapView>
          ) : (
            <View style={styles.liveMapWaiting}>
              <Text style={styles.driveStat}>waiting for GPS fix…</Text>
            </View>
          )}
          {liveFix && !followMe && (
            <Pressable style={styles.recenterBtn} onPress={recenterDriveMap} accessibilityLabel="Recenter map" hitSlop={8}>
              <Ionicons name="locate" size={22} color="#1a1d21" />
            </Pressable>
          )}
        </View>
        <Pressable style={styles.stopBtn} onPress={stopDrive}>
          <Text style={styles.primaryBtnText}>END NAVIGATION</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === "settings") {
    return (
      <View style={[styles.screen, styles.planScreen]}>
        <StatusBar style="dark" />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Pressable style={styles.backRow} onPress={() => setPhase("plan")} hitSlop={8}>
            <Text style={styles.backRowText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.h1}>Alert settings</Text>

          <View style={styles.sectionCard}>
            <Text style={styles.settingsLabel}>Sensitivity</Text>
            <View style={styles.segmentRow}>
              {SENSITIVITY_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[styles.segmentBtn, alertSettings.sensitivity === opt.value && styles.segmentBtnActive]}
                  onPress={() => updateAlertSettings({ sensitivity: opt.value })}
                >
                  <Text style={[styles.segmentText, alertSettings.sensitivity === opt.value && styles.segmentTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.settingsLabel, styles.settingsLabelSpaced]}>Alert mode</Text>
            <View style={styles.segmentRow}>
              {ALERT_MODE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[styles.segmentBtn, alertSettings.mode === opt.value && styles.segmentBtnActive]}
                  onPress={() => updateAlertSettings({ mode: opt.value })}
                >
                  <Text style={[styles.segmentText, alertSettings.mode === opt.value && styles.segmentTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>Privacy</Text>
            <Text style={styles.privacyText}>
              Detections during navigation are ephemeral — used only to score routes and show on-map markers for this
              drive, never saved locally or synced to the cloud. Choosing a destination sends only that route
              request&apos;s start and end points to the routing/geocoding services — never your track, never an
              identifier.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, styles.planScreen]}>
      <StatusBar style="dark" />
      <View style={styles.homeTopRow}>
        <View style={styles.homeHeaderText}>
          <Text style={styles.h1}>Navigate</Text>
          <Text style={styles.planHint}>
            {dest ? "Tap a route to choose it." : planCenter ? "Search for a destination, or tap the map." : "Finding your location…"}
          </Text>
        </View>
        <Pressable
          style={styles.settingsBtn}
          onPress={() => setPhase("settings")}
          accessibilityLabel="Alert settings"
          hitSlop={8}
        >
          <Ionicons name="settings-outline" size={22} color="#5b6570" />
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
          <Text style={styles.closeBtnText}>×</Text>
        </Pressable>
      </View>

      <View style={styles.searchFieldWrap}>
        <View style={[styles.searchInputRow, activeField === "origin" && styles.searchInputRowActive]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={originQuery}
            placeholder="Choose starting point, or tap on the map"
            placeholderTextColor="#8a939d"
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
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={destQuery}
            placeholder="Destination address, or tap on the map"
            placeholderTextColor="#8a939d"
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
            const routeColor = i === routeChoice ? "#1f6fe8" : "#9aa4b0";
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
          {origin && <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} pinColor="#1f6fe8" title="Start" />}
          {dest && <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} pinColor="#1a7f37" title="Destination" />}
        </MapView>
      </View>
      {routeBusy && <Text style={styles.planStatus}>finding routes…</Text>}
      {routeError && <Text style={styles.planError}>{routeError}</Text>}
      {routeOptions.length > 0 && (
        <View style={styles.routeChips}>
          {routeOptions.map((r, i) => {
            const score = routeScores[i];
            const active = i === routeChoice;
            return (
              <Pressable key={`chip-${i}`} style={[styles.routeChip, active && styles.routeChipActive]} onPress={() => setRouteChoice(i)}>
                <Text style={[styles.routeChipTitle, active && styles.routeChipTitleActive]}>
                  {Math.round(r.durationSeconds / 60)} min · {(r.distanceMeters / 1609.34).toFixed(1)} mi
                </Text>
                {score && score.hazardExposureScore > 0 && (
                  <Text style={styles.routeChipMeta}>rough-road exposure {Math.round(score.hazardExposureScore * 100)}%</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={styles.planToggleCard}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextWrap}>
            <Text style={styles.toggleLabel}>Avoid rough roads</Text>
            <Text style={styles.toggleDescription}>Prefers routes away from hazards detected this session.</Text>
          </View>
          <Switch
            value={avoidRough}
            onValueChange={(v) => {
              setAvoidRough(v);
              avoidRoughRef.current = v;
              rechoose(v);
            }}
          />
        </View>
      </View>
      <Pressable style={styles.primaryBtn} onPress={() => (chosen ? void startDrive(chosen) : void startDrive())}>
        <Text style={styles.primaryBtnText}>{chosen ? "START NAVIGATION" : "START DRIVE"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f7f9", paddingTop: 56, paddingHorizontal: 16 },
  driveScreen: { backgroundColor: "#101317", paddingHorizontal: 0 },
  planScreen: {},
  homeTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 12 },
  settingsBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  homeHeaderText: { flex: 1 },
  h1: { fontSize: 28, fontWeight: "800", color: "#1a1d21" },
  planHint: { fontSize: 14, color: "#5b6570", marginTop: 4 },
  closeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  closeBtnText: { fontSize: 26, color: "#5b6570", lineHeight: 26 },
  backRow: { paddingVertical: 6, marginBottom: 8 },
  backRowText: { color: "#e8442e", fontSize: 15, fontWeight: "600" },
  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8a939d",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  settingsLabel: { fontSize: 14, fontWeight: "700", color: "#1a1d21", marginBottom: 8 },
  settingsLabelSpaced: { marginTop: 16 },
  segmentRow: { flexDirection: "row", gap: 8 },
  segmentBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e3e6ea",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  segmentBtnActive: { backgroundColor: "#e8442e", borderColor: "#e8442e" },
  segmentText: { fontSize: 13, fontWeight: "600", color: "#1a1d21" },
  segmentTextActive: { color: "#fff" },
  privacyText: { fontSize: 13, color: "#5b6570", lineHeight: 19 },
  searchFieldWrap: { marginBottom: 8, zIndex: 5 },
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e3e6ea",
    paddingHorizontal: 12,
  },
  searchInputRowActive: { borderColor: "#1f6fe8" },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: "#1a1d21" },
  suggestionList: {
    backgroundColor: "#fff",
    borderRadius: 10,
    marginTop: 4,
    maxHeight: 180,
    borderWidth: 1,
    borderColor: "#e3e6ea",
  },
  suggestionRow: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#eef0f2" },
  suggestionRowText: { fontSize: 14, color: "#1a1d21" },
  planError: { color: "#d92616", fontSize: 13, marginBottom: 6 },
  planStatus: { color: "#5b6570", fontSize: 13, marginBottom: 6 },
  planMapWrap: { flex: 1, borderRadius: 12, overflow: "hidden", marginVertical: 8, minHeight: 220 },
  routeChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  routeChip: { borderWidth: 1, borderColor: "#e3e6ea", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#fff" },
  routeChipActive: { borderColor: "#1f6fe8", backgroundColor: "#eaf1fd" },
  routeChipTitle: { fontSize: 13, fontWeight: "700", color: "#1a1d21" },
  routeChipTitleActive: { color: "#1f6fe8" },
  routeChipMeta: { fontSize: 11, color: "#8a939d", marginTop: 2 },
  planToggleCard: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 10 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  toggleTextWrap: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: "700", color: "#1a1d21" },
  toggleDescription: { fontSize: 12, color: "#8a939d", marginTop: 2 },
  primaryBtn: { backgroundColor: "#e8442e", paddingVertical: 16, borderRadius: 999, marginBottom: 16, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  driveHud: { flexDirection: "row", paddingTop: 12, paddingHorizontal: 20 },
  driveHudCell: { flex: 1 },
  driveHudCellRight: { alignItems: "flex-end" },
  driveSpeed: { fontSize: 48, fontWeight: "200", color: "#fff" },
  driveSpeedUnit: { fontSize: 16, color: "#8a939d" },
  driveStat: { fontSize: 12, color: "#8a939d", marginTop: 2 },
  driveCount: { fontSize: 40, fontWeight: "800", color: "#e8442e" },
  navBanner: { backgroundColor: "#1a1d21", marginHorizontal: 16, marginTop: 10, borderRadius: 12, padding: 14 },
  navBannerDist: { color: "#8fb4f5", fontSize: 13, fontWeight: "700" },
  navBannerText: { color: "#fff", fontSize: 17, fontWeight: "700", marginTop: 2 },
  liveMapWrap: { flex: 1, marginTop: 12 },
  liveMap: { flex: 1 },
  liveMapWaiting: { flex: 1, alignItems: "center", justifyContent: "center" },
  carDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#1f6fe8", borderWidth: 3, borderColor: "#fff" },
  recenterBtn: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  recenterBtnText: { fontSize: 18 },
  stopBtn: {
    backgroundColor: "#e8442e",
    paddingVertical: 18,
    marginHorizontal: 16,
    marginVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
});
