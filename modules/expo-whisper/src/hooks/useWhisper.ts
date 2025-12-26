/**
 * useWhisper: React hook for file and buffer transcription
 *
 * Features:
 * - Simple API for transcription
 * - Progress tracking
 * - Automatic error handling
 * - Result management
 * - Cancellation support
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Whisper, WhisperInitOptions } from '../Whisper';
import { TranscribeResult, Segment } from '../types/whisper';
import { getLogger } from '../utils/Logger';

export interface UseWhisperOptions extends Partial<WhisperInitOptions> {
  language?: string;
  optimizationMode?: 'quality' | 'balanced' | 'low-latency';
}

export interface UseWhisperReturn {
  progress: number;
  result: TranscribeResult | null;
  error: Error | null;
  isLoading: boolean;
  segments: Segment[];

  transcribeFile: (filePath: string) => Promise<void>;
  transcribeBuffer: (audioData: Uint8Array) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

/**
 * Hook for transcribing audio files and buffers
 */
export function useWhisper(options: UseWhisperOptions = {}): UseWhisperReturn {
  const logger = getLogger();
  const whisperRef = useRef<Whisper | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);

  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);

  // Initialize Whisper on mount
  useEffect(() => {
    let mounted = true;

    const initializeWhisper = async () => {
      try {
        if (!options.modelPath) {
          logger.warn('[useWhisper] modelPath not provided in options');
          return;
        }

        if (!whisperRef.current) {
          whisperRef.current = await Whisper.initialize({
            modelPath: options.modelPath,
            useGpu: options.useGpu ?? true,
            useCoreMLIos: options.useCoreMLIos,
            useFlashAttn: options.useFlashAttn,
            useNnapi: options.useNnapi,
            useGpuDelegate: options.useGpuDelegate,
          });
        }
      } catch (err) {
        const initError = err instanceof Error ? err : new Error(String(err));
        logger.error('[useWhisper] Initialization failed:', initError);
        if (mounted) {
          setError(initError);
        }
      }
    };

    initializeWhisper();

    return () => {
      mounted = false;
    };
  }, [
    options.modelPath,
    options.useGpu,
    options.useCoreMLIos,
    options.useFlashAttn,
    options.useNnapi,
    options.useGpuDelegate,
    logger,
  ]);

  /**
   * Transcribe a file
   */
  const transcribeFile = useCallback(
    async (filePath: string) => {
      if (!whisperRef.current) {
        setError(new Error('Whisper not initialized'));
        return;
      }

      setIsLoading(true);
      setError(null);
      setProgress(0);
      setResult(null);
      setSegments([]);

      try {
        logger.info(`Starting file transcription`, { filePath });

        const task = await whisperRef.current.transcribeFile(filePath, {
          language: options.language,
          onProgress: (p: number) => setProgress(p),
          onSegment: (segment: Segment) => {
            setSegments((prev) => [...prev, segment]);
          },
        });

        currentTaskIdRef.current = task.taskId;

        if (task.result) {
          setResult(task.result);
          setProgress(100);
          logger.info(`File transcription completed`, {
            segments: task.result.segments.length,
            duration: task.result.duration,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        logger.error(`File transcription error`, { error: error.message });
      } finally {
        setIsLoading(false);
      }
    },
    [options.language, logger]
  );

  /**
   * Transcribe audio buffer
   */
  const transcribeBuffer = useCallback(
    async (audioData: Uint8Array) => {
      if (!whisperRef.current) {
        setError(new Error('Whisper not initialized'));
        return;
      }

      setIsLoading(true);
      setError(null);
      setProgress(0);
      setResult(null);
      setSegments([]);

      try {
        logger.info(`Starting buffer transcription`, {
          audioBytes: audioData.length,
        });

        const task = await whisperRef.current.transcribeBuffer(audioData, {
          language: options.language,
          onProgress: (p: number) => setProgress(p),
          onSegment: (segment: Segment) => {
            setSegments((prev) => [...prev, segment]);
          },
        });

        currentTaskIdRef.current = task.taskId;

        if (task.result) {
          setResult(task.result);
          setProgress(100);
          logger.info(`Buffer transcription completed`, {
            segments: task.result.segments.length,
            duration: task.result.duration,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        logger.error(`Buffer transcription error`, { error: error.message });
      } finally {
        setIsLoading(false);
      }
    },
    [options.language, logger]
  );

  /**
   * Cancel current transcription
   */
  const cancel = useCallback(async () => {
    if (currentTaskIdRef.current && whisperRef.current) {
      try {
        const task = whisperRef.current.getTask(currentTaskIdRef.current);
        if (task) {
          await task.cancel();
          setIsLoading(false);
          logger.info(`Transcription cancelled`);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error(`Error cancelling transcription`, { error: error.message });
      }
    }
  }, [logger]);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setProgress(0);
    setResult(null);
    setError(null);
    setSegments([]);
    currentTaskIdRef.current = null;
  }, []);

  return {
    progress,
    result,
    error,
    isLoading,
    segments,
    transcribeFile,
    transcribeBuffer,
    cancel,
    reset,
  };
}
