import { registerRootComponent } from 'expo';
import { Text, TextInput } from 'react-native';

import App from './App';

// iOS applique le "Dynamic Type" du système et agrandit tout le texte (→ effet
// "zoomé" par rapport à Android). On fige les polices sur les tailles conçues
// pour une expérience identique sur les deux plateformes.
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.allowFontScaling = false;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
