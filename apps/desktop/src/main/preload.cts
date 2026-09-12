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
  transcription: {
    start: (options: unknown) => ipcRenderer.invoke('transcription:start', options),
    stop: () => ipcRenderer.invoke('transcription:stop'),
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on('transcription:event', handler);
      return () => ipcRenderer.removeListener('transcription:event', handler);
    },
  },
  questions: {
    onDetected: (listener: (question: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on('question:event', handler);
      return () => ipcRenderer.removeListener('question:event', handler);
    },
  },
});
