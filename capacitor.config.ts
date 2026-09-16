import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'golf.activitee.app',
  appName: 'ActiviTee',
  webDir: 'public',

  server: {
    url: 'http://localhost:3000',
    cleartext: true,
  },
};

export default config;