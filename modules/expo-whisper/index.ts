/**
 * expo-whisper: Main entry point
 *
 * Simplified API with 2 entry points:
 * - import { Whisper } from 'expo-whisper'      // Non-React
 * - import { useWhisper } from 'expo-whisper'   // React
 */

// Main API
export { Whisper } from './src/Whisper';
export type { WhisperInitOptions } from './src/Whisper';

// React hooks (primary entry for React users)
export { useWhisper } from './src/hooks/useWhisper';
export type { UseWhisperOptions, UseWhisperReturn } from './src/hooks/useWhisper';

export { useRealtimeTranscription } from './src/hooks/useRealtimeTranscription';
export type {
  UseRealtimeTranscriptionOptions,
  UseRealtimeTranscriptionReturn,
  RealtimeMetrics,
} from './src/hooks/useRealtimeTranscription';

export { useWhisperMetrics } from './src/hooks/useWhisperMetrics';

// Utilities (unchanged)
export {
  downloadModel,
  isModelDownloaded,
  getModelPath,
  deleteModel,
  cleanAllModels,
  getModelsDirectory,
  requestMicrophonePermissions,
  MODEL_SIZES,
} from './src/utils/AppHelpers';

// Types (from canonical source)
export type {
  TranscribeResult,
  Segment,
  TranscribeOptions,
  WhisperModelSize,
  TranscriptionTask,
} from './src/types/whisper';

export { WHISPER_MODELS } from './src/types/whisper';

// Default export for convenience
export { Whisper as default } from './src/Whisper';
