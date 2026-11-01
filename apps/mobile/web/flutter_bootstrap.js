{{flutter_js}}
{{flutter_build_config}}

// Same query as frame.css. Touch devices keep Flutter's full-page mode, which is what
// reports the on-screen keyboard to the app; a framed (embedded) view would not get it on iOS.
const framed = window.matchMedia(
  '(min-width: 500px) and (hover: hover) and (pointer: fine)',
).matches;

function createDeviceFrame() {
  const part = (parent, className) => {
    const el = document.createElement('div');
    el.className = className;
    parent.appendChild(el);
    return el;
  };
  const device = part(document.body, 'device');
  const screen = part(device, 'device-screen');
  part(screen, 'device-island').setAttribute('aria-hidden', 'true');
  const host = part(screen, 'device-app');
  part(screen, 'device-home').setAttribute('aria-hidden', 'true');
  return host;
}

_flutter.loader.load({
  config: framed ? { hostElement: createDeviceFrame() } : {},
  serviceWorkerSettings: {
    serviceWorkerVersion: {{flutter_service_worker_version}},
  },
});
