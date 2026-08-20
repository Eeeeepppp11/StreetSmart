import { createElement } from 'react';
import { registerRootComponent } from 'expo';

// Must import after 'expo': expo/src/winter installs its own UTF-8-only
// TextDecoder as a side effect of the import above, unconditionally
// overwriting anything set earlier. Ours has to run after expo's install
// so it's the one still standing when ./App (and h3-js, via geo/routing) loads.
import './polyfills';

import App from './App';
import { AuthProvider } from './auth/AuthContext';

function Root() {
  return createElement(AuthProvider, null, createElement(App));
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);
