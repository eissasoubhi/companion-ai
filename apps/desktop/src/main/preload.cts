import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('companion', {
  platform: process.platform,
  microphone: {
    getPermissionStatus: () => ipcRenderer.invoke('microphone:get-permission'),
    requestPermission: () => ipcRenderer.invoke('microphone:request-permission'),
  },
  systemAudio: {
    getCapability: () => ipcRenderer.invoke('system-audio:get-capability'),
  },
  network: {
    runDiagnostic: () => ipcRenderer.invoke('network:run-diagnostic'),
  },
  audio: {
    writeChunk: (chunk: unknown) => ipcRenderer.invoke('audio:write-chunk', chunk),
  },
});
