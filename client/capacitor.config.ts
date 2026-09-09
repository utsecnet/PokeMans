import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell for the Android build.
 *
 * The app is a WebView, not a Trusted Web Activity, and that is deliberate. Play's
 * minimum-functionality policy rejects apps that mirror a website, and a TWA additionally
 * fails closed testing on its own terms: the required tester activity happens inside Chrome
 * rather than inside the app, so review sees no in-app usage. A WebView shell with native
 * storage is the shape that passes, and it is also the only shape that can hold an on-device
 * database.
 */
const config: CapacitorConfig = {
  appId: 'net.utsec.pokemans',
  appName: 'PokeMans',
  webDir: 'dist',

  plugins: {
    CapacitorSQLite: {
      android: {
        /**
         * Both databases live in app-private internal storage, which is the Android
         * equivalent of the %appdata% location this replaces: unreadable by other apps and
         * removed on uninstall. Never external storage — scoped storage aside, collection
         * data has no business being world-readable.
         */
        databaseLocation: 'default',
        // Encryption is off for now. It would protect the catalogue, which is public data
        // re-downloadable from TCGdex, while doing nothing for the one secret in the app —
        // the API keys, which belong in the Keystore rather than in a database at all.
        biometricAuth: false,
      },
    },
  },

  server: {
    // Set by `cap run android --livereload --external`; left unset so a release build can
    // never accidentally point at a laptop on someone's LAN.
    cleartext: false,
  },
};

export default config;
