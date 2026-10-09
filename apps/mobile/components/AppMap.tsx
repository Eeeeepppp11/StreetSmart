import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import MapView, {
  Marker,
  Polyline,
  type MapMarkerProps as MarkerProps,
  type MapPolylineProps as PolylineProps,
} from "react-native-maps";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

/**
 * Cross-platform map. iOS uses react-native-maps (Apple Maps). Android in
 * Expo Go can't use react-native-maps reliably — it relies on Expo Go's shared
 * Google Maps key, which is often blocked and leaves a gray/black map — so
 * Android renders the same declarative children into a Leaflet map inside a
 * WebView (OpenStreetMap tiles, no API key).
 *
 * Screens use only `AppMapView` / `AppMarker` / `AppPolyline` and the small
 * subset of react-native-maps props listed below.
 */

export interface AppRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface AppMapHandle {
  animateToRegion(region: AppRegion, durationMs?: number): void;
  fitToCoordinates(
    coords: { latitude: number; longitude: number }[],
    opts?: { edgePadding?: { top: number; right: number; bottom: number; left: number }; animated?: boolean }
  ): void;
}

export interface AppMapProps {
  style?: StyleProp<ViewStyle>;
  initialRegion: AppRegion;
  showsUserLocation?: boolean;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
  toolbarEnabled?: boolean;
  onPress?: (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void;
  onPanDrag?: () => void;
  onRegionChangeComplete?: () => void;
  children?: ReactNode;
}

// ---------------------------------------------------------------- Android --

function AndroidMarker(_props: MarkerProps) {
  return null;
}
function AndroidPolyline(_props: PolylineProps) {
  return null;
}

interface MarkerSpec {
  lat: number;
  lng: number;
  color: string;
  opacity: number;
  title?: string;
  description?: string;
  /** Custom-view marker (e.g. a styled dot) rendered as a sized circle. */
  dot?: { size: number; bg: string; borderWidth: number; borderColor: string };
  rotation: number;
  pressable: boolean;
}
interface LineSpec {
  pts: [number, number][];
  color: string;
  weight: number;
  dash?: string;
  pressable: boolean;
}

function dashToString(pattern: number[] | undefined): string | undefined {
  return pattern && pattern.length ? pattern.join(",") : undefined;
}

function collect(
  children: ReactNode,
  markers: { spec: MarkerSpec; props: MarkerProps }[],
  lines: { spec: LineSpec; props: PolylineProps }[]
) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as React.ReactElement<any>;
    if (el.type === Fragment) {
      collect(el.props.children, markers, lines);
    } else if (el.type === AndroidMarker) {
      const p = el.props as MarkerProps;
      const inner = Children.toArray(p.children).find(isValidElement) as React.ReactElement<any> | undefined;
      let dot: MarkerSpec["dot"];
      if (inner) {
        const s = StyleSheet.flatten(inner.props.style) ?? {};
        dot = {
          size: Number(s.width ?? 16),
          bg: String(s.backgroundColor ?? "#2563eb"),
          borderWidth: Number(s.borderWidth ?? 2),
          borderColor: String(s.borderColor ?? "#fff"),
        };
      }
      markers.push({
        props: p,
        spec: {
          lat: p.coordinate.latitude,
          lng: p.coordinate.longitude,
          color: p.pinColor ?? "#d93025",
          opacity: p.opacity ?? 1,
          title: p.title,
          description: p.description,
          dot,
          rotation: p.rotation ?? 0,
          pressable: typeof p.onPress === "function",
        },
      });
    } else if (el.type === AndroidPolyline) {
      const p = el.props as PolylineProps;
      lines.push({
        props: p,
        spec: {
          pts: p.coordinates.map((c: { latitude: number; longitude: number }) => [c.latitude, c.longitude]),
          color: p.strokeColor ?? "#2563eb",
          weight: p.strokeWidth ?? 3,
          dash: dashToString(p.lineDashPattern as number[] | undefined),
          pressable: typeof p.onPress === "function",
        },
      });
    }
  });
}

const LEAFLET_HTML = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html,body,#map{height:100%;width:100%;margin:0;padding:0;background:#e8e6e0}
  .leaflet-control-attribution{font-size:9px}
  .dot{box-sizing:border-box;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.4)}
</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  function send(m){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  var map = L.map('map', {zoomControl:false, attributionControl:true});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  var layer = L.layerGroup().addTo(map);
  function bounds(r){
    return [[r.latitude - r.latitudeDelta/2, r.longitude - r.longitudeDelta/2],
            [r.latitude + r.latitudeDelta/2, r.longitude + r.longitudeDelta/2]];
  }
  map.on('click', function(e){ send({t:'tap', lat:e.latlng.lat, lng:e.latlng.lng}); });
  map.on('dragstart', function(){ send({t:'pan'}); });
  var inited = false;
  map.on('moveend', function(){ if (inited) send({t:'moved'}); });

  window.__init = function(cfg){
    map.fitBounds(bounds(cfg.region), {animate:false});
    if (!cfg.scroll) map.dragging.disable();
    if (!cfg.zoom) { map.touchZoom.disable(); map.doubleClickZoom.disable(); map.scrollWheelZoom.disable(); }
    inited = true;
    send({t:'ready'});
  };
  window.__overlays = function(o){
    layer.clearLayers();
    o.lines.forEach(function(l, i){
      var pl = L.polyline(l.pts, {
        color:l.color, weight:l.weight, opacity:0.95, dashArray:l.dash || null,
        lineCap:'round', lineJoin:'round',
        interactive:l.pressable, bubblingMouseEvents:false
      }).addTo(layer);
      if (l.pressable) pl.on('click', function(){ send({t:'line', i:i}); });
    });
    o.markers.forEach(function(m, i){
      var html, size;
      if (m.dot) {
        size = m.dot.size;
        html = '<div class="dot" style="width:'+size+'px;height:'+size+'px;background:'+m.dot.bg+
               ';border:'+m.dot.borderWidth+'px solid '+m.dot.borderColor+'"></div>';
      } else {
        size = 18;
        html = '<div class="dot" style="width:18px;height:18px;background:'+m.color+';border:2px solid #fff"></div>';
      }
      var mk = L.marker([m.lat, m.lng], {
        icon: L.divIcon({className:'', html:html, iconSize:[size,size], iconAnchor:[size/2,size/2]}),
        opacity:m.opacity, keyboard:false, bubblingMouseEvents:false
      }).addTo(layer);
      if (m.title) {
        mk.bindPopup('<b>'+m.title+'</b>'+(m.description?'<br>'+m.description:''), {closeButton:false});
      }
      mk.on('click', function(){ send({t:'marker', i:i}); });
    });
  };
  window.__animate = function(r, ms){
    map.fitBounds(bounds(r), {animate:true, duration:(ms||400)/1000});
  };
  window.__fit = function(pts, pad, animated){
    if (!pts.length) return;
    map.fitBounds(pts, {paddingTopLeft:[pad.left,pad.top], paddingBottomRight:[pad.right,pad.bottom], animate:animated});
  };
  // Keep the map sized to its container (layout can change after mount).
  window.addEventListener('resize', function(){ map.invalidateSize(); });
})();
</script></body></html>`;

const AndroidMapView = forwardRef<AppMapHandle, AppMapProps>(function AndroidMapView(props, ref) {
  const { style, initialRegion, scrollEnabled = true, zoomEnabled = true, children } = props;
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const queue = useRef<string[]>([]);
  const callbacks = useRef({ props, markers: [] as { props: MarkerProps }[], lines: [] as { props: PolylineProps }[] });

  const run = useCallback((js: string) => {
    if (!ready.current) {
      queue.current.push(js);
      return;
    }
    web.current?.injectJavaScript(`${js};true;`);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion(region, durationMs) {
        run(`window.__animate(${JSON.stringify(region)}, ${durationMs ?? 400})`);
      },
      fitToCoordinates(coords, opts) {
        const pad = opts?.edgePadding ?? { top: 0, right: 0, bottom: 0, left: 0 };
        run(
          `window.__fit(${JSON.stringify(coords.map((c) => [c.latitude, c.longitude]))}, ${JSON.stringify(pad)}, ${
            opts?.animated ?? true
          })`
        );
      },
    }),
    [run]
  );

  const overlays = useMemo(() => {
    const markers: { spec: MarkerSpec; props: MarkerProps }[] = [];
    const lines: { spec: LineSpec; props: PolylineProps }[] = [];
    collect(children, markers, lines);
    return { markers, lines };
  }, [children]);

  callbacks.current = { props, markers: overlays.markers, lines: overlays.lines };

  const overlayJson = useMemo(
    () => JSON.stringify({ markers: overlays.markers.map((m) => m.spec), lines: overlays.lines.map((l) => l.spec) }),
    [overlays]
  );

  useEffect(() => {
    run(`window.__overlays(${overlayJson})`);
  }, [overlayJson, run]);

  const initScript = useMemo(
    () =>
      `window.__init(${JSON.stringify({
        region: initialRegion,
        scroll: scrollEnabled,
        zoom: zoomEnabled,
      })});true;`,
    // Initial region/gestures are applied once, like react-native-maps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function onMessage(e: WebViewMessageEvent) {
    let m: { t: string; i?: number; lat?: number; lng?: number };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    const cb = callbacks.current;
    switch (m.t) {
      case "ready": {
        ready.current = true;
        const pending = queue.current;
        queue.current = [];
        for (const js of pending) web.current?.injectJavaScript(`${js};true;`);
        run(`window.__overlays(${overlayJson})`);
        break;
      }
      case "tap":
        cb.props.onPress?.({ nativeEvent: { coordinate: { latitude: m.lat!, longitude: m.lng! } } });
        break;
      case "pan":
        cb.props.onPanDrag?.();
        break;
      case "moved":
        cb.props.onRegionChangeComplete?.();
        break;
      case "marker":
        cb.markers[m.i!]?.props.onPress?.({} as never);
        break;
      case "line":
        cb.lines[m.i!]?.props.onPress?.({} as never);
        break;
    }
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={web}
        originWhitelist={["*"]}
        source={{ html: LEAFLET_HTML, baseUrl: "https://localhost/" }}
        onLoadEnd={() => web.current?.injectJavaScript(initScript)}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        overScrollMode="never"
        nestedScrollEnabled
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        style={styles.web}
      />
    </View>
  );
});

// -------------------------------------------------------------------- iOS --

const NativeMapView = forwardRef<AppMapHandle, AppMapProps>(function NativeMapView(props, ref) {
  return <MapView ref={ref as never} {...props} />;
});

const IS_ANDROID = Platform.OS === "android";

export const AppMapView = IS_ANDROID ? AndroidMapView : NativeMapView;
export const AppMarker: ComponentType<MarkerProps> = IS_ANDROID ? AndroidMarker : Marker;
export const AppPolyline: ComponentType<PolylineProps> = IS_ANDROID ? AndroidPolyline : Polyline;

const styles = StyleSheet.create({
  container: { overflow: "hidden", backgroundColor: "#e8e6e0" },
  web: { flex: 1, backgroundColor: "transparent" },
});
