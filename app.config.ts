import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';

const appEnv = process.env.APP_ENV?.trim();
const isProduction = appEnv === 'production';

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

const revenueCatTestApiKey = envValue('EXPO_PUBLIC_REVENUECAT_TEST_API_KEY');
const revenueCatIosApiKey = envValue('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY');
const revenueCatAndroidApiKey = envValue('EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY');

if (isProduction) {
  if (!revenueCatIosApiKey) {
    console.warn('[app.config] Missing EXPO_PUBLIC_REVENUECAT_IOS_API_KEY for production RevenueCat config.');
  }
  if (!revenueCatAndroidApiKey) {
    console.warn('[app.config] Missing EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY for production RevenueCat config.');
  }
} else if (!revenueCatTestApiKey) {
  console.warn('[app.config] Missing EXPO_PUBLIC_REVENUECAT_TEST_API_KEY for non-production RevenueCat config.');
}

const revenueCatApiKeyIos = isProduction ? revenueCatIosApiKey : revenueCatTestApiKey;
const revenueCatApiKeyAndroid = isProduction ? revenueCatAndroidApiKey : revenueCatTestApiKey;

const config: ExpoConfig = {
  name: 'KidLens AI',
  slug: 'kidlens',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'kidlens',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.mikhail.kidlensai',
    buildNumber: '6',
    icon: './assets/images/icon.png',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'com.mikhail.kidlensai',
    versionCode: 6,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/icon.png',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },

  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },

  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          backgroundColor: '#000000',
        },
      },
    ],
    'expo-secure-store',
    'expo-video',
    'expo-web-browser',
    '@react-native-community/datetimepicker',
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  extra: {
    router: {},
    eas: {
      projectId: '98221dcc-7f82-4769-a8b6-ceaf3e9fb8e0',
    },

    revenueCatApiKeyIos,
    revenueCatApiKeyAndroid,
  },

  owner: 'shvetsm123',
};

export default config;