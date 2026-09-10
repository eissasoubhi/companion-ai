import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('companion', {
  platform: process.platform,
  microphone: {
    getPermissionStatus: () => ipcRenderer.invoke('microphone:get-permission'),
    requestPermission: () => ipcRenderer.invoke('microphone:request-permission'),
  },
});
