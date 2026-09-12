import { app, BrowserWindow, ipcMain, session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QuestionStream } from '@companion-ai/conversation';

import { AnswerRuntime } from './answer-runtime.js';
import { registerAudioIpcHandlers } from './audio-ipc.js';
import {
  configureMediaPermissionHandlers,
  getMicrophonePermissionStatus,
  requestMicrophonePermission,
} from './media-permissions.js';
import { runNetworkDiagnostic } from './network-diagnostic.js';
import { createOpenAIProviderFromEnv } from './openai-llm-provider.js';
import {
  configureSystemAudioCapture,
  getSystemAudioCapability,
} from './system-audio.js';
import { TranscriptionIngress } from './transcription-ingress.js';
import { TranscriptionRuntime } from './transcription-runtime.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function registerIpcHandlers(): {
  readonly transcription: TranscriptionRuntime;
  readonly answers: AnswerRuntime;
} {
  ipcMain.handle('microphone:get-permission', () => getMicrophonePermissionStatus());
  ipcMain.handle('microphone:request-permission', () => requestMicrophonePermission());
  ipcMain.handle('system-audio:get-capability', () => getSystemAudioCapability());
  ipcMain.handle('network:run-diagnostic', () => runNetworkDiagnostic());

  const ingress = new TranscriptionIngress(registerAudioIpcHandlers());
  const questions = new QuestionStream();
  const answers = new AnswerRuntime({
    createProvider: () => createOpenAIProviderFromEnv(),
    // Verified context persistence/import is a separate P0 lane. Until it exists,
    // generation receives no private context rather than unverified renderer data.
    getContextItems: () => [],
    emit: (event) => broadcast('answer:event', event),
  });
  const transcription = new TranscriptionRuntime(ingress, (event) => {
    broadcast('transcription:event', event);

    if (event.type === 'transcript') {
      const question = questions.process(event.segment);
      if (question) {
        broadcast('question:event', question);
        void answers.handleQuestion(question);
      }
    }
  });

  ipcMain.handle('transcription:start', (_event, options: unknown) => {
    const language =
      typeof options === 'object' && options !== null &&
      'language' in options && typeof options.language === 'string'
        ? options.language.trim() || undefined
        : undefined;
    return transcription.start(language === undefined ? {} : { language });
  });
  ipcMain.handle('transcription:stop', async () => {
    answers.stop();
    try {
      await transcription.stop();
    } finally {
      questions.reset();
    }
  });

  return { transcription, answers };
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'Companion AI',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDir, 'preload.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  void window.loadFile(join(currentDir, '../renderer/index.html'));

  return window;
}

app.whenReady().then(() => {
  configureMediaPermissionHandlers(session.defaultSession);
  configureSystemAudioCapture(session.defaultSession);
  const runtimes = registerIpcHandlers();
  createMainWindow();

  app.once('before-quit', () => {
    runtimes.answers.stop();
    void runtimes.transcription.stop();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
