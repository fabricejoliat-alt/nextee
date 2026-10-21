import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'golf.activitee.app',
  appName: 'ActiviTee',
  webDir: 'public',
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'banner', 'list'] },
  },

  server: {
    url: 'https://activitee.app',
  },
};

export default config;
