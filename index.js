/**
 * @format
 */

// Import URL polyfill for React Native/Hermes compatibility
import 'react-native-url-polyfill/auto';

import {AppRegistry, LogBox} from 'react-native';

// Silence LogBox in E2E builds so the in-app warning toast doesn't cover
// chat-bottom controls Appium needs. Left active otherwise so warnings
// surface during development.
if (__E2E__) {
  LogBox.ignoreAllLogs(true);
}

// The Supertonic ONNX path can emit a native console.error before its promise
// rejects. TTSStore catches that rejection, disables Supertonic autospeak, and
// releases the engine; keep the recoverable native line from taking over dev
// builds with a redbox.
LogBox.ignoreLogs(['[Supertonic][Inference] estimateVector']);

import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);

// Compatibility for dev installs built before the LLMm rebrand. Older native
// shells still request "PocketPal" from Metro until the rebuilt app is installed.
if (appName !== 'PocketPal') {
  AppRegistry.registerComponent('PocketPal', () => App);
}
