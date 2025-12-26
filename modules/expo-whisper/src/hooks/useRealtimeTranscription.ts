/**
 * useRealtimeTranscription: React hook for streaming/realtime audio transcription
 *
 * Features:
 * - Streaming audio chunk processing
 * - Real-time segment updates
 * - Connection state management
 * - Pause/resume support
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Whisper, WhisperInitOptions } from '../Whisper';
import { TranscribeResult, Segment } from '../types/whisper';
import { getLogger } from '../utils/Logger';
import * as AudioProcessing from '../utils/AudioProcessing';

export interface UseRealtimeTranscriptionOptions extends Partial<WhisperInitOptions> {
	language?: string;
	optimizationMode?: 'quality' | 'balanced' | 'low-latency';
	chunkSizeMs?: number;
	silenceThresholdDb?: number;
	autoStartRecording?: boolean;
	enableEnergyMonitoring?: boolean;
	enableNoiseDetection?: boolean;
}

export interface RealtimeMetrics {
	audioLevel: number;
	chunksProcessed: number;
	droppedChunks: number;
	averageLatencyMs: number;
	isDetectingSilence: boolean;
	bufferHealth: 'healthy' | 'warning' | 'critical';
}

export interface UseRealtimeTranscriptionReturn {
	isConnected: boolean;
	isRecording: boolean;
	isPaused: boolean;
	result: TranscribeResult | null;
	error: Error | null;
	segments: Segment[];
	interimText: string;
	metrics: RealtimeMetrics;

	startRecording: () => Promise<void>;
	stopRecording: () => Promise<void>;
	pauseRecording: () => Promise<void>;
	resumeRecording: () => Promise<void>;
	submitAudioChunk: (audioData: Uint8Array) => Promise<void>;
	clearInterimText: () => void;
	resetSession: () => void;
}

/**
 * Hook for real-time audio transcription (streaming)
 */
export function useRealtimeTranscription(
	options: UseRealtimeTranscriptionOptions = {},
): UseRealtimeTranscriptionReturn {
	const logger = getLogger();
	const whisperRef = useRef<Whisper | null>(null);
	const metricsRef = useRef({
		audioLevel: 0,
		chunksProcessed: 0,
		droppedChunks: 0,
		totalLatency: 0,
		latencyMeasurements: 0,
	});
	const audioBufferRef = useRef<Uint8Array[]>([]);
	const processingRef = useRef(false);

	const [isConnected, setIsConnected] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [isPaused, setIsPaused] = useState(false);
	const [result, setResult] = useState<TranscribeResult | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [segments, setSegments] = useState<Segment[]>([]);
	const [interimText, setInterimText] = useState('');
	const [metrics, setMetrics] = useState<RealtimeMetrics>({
		audioLevel: 0,
		chunksProcessed: 0,
		droppedChunks: 0,
		averageLatencyMs: 0,
		isDetectingSilence: false,
		bufferHealth: 'healthy',
	});

	const chunkSizeMs = options.chunkSizeMs ?? 500;
	const silenceThresholdDb = options.silenceThresholdDb ?? -40;

	useEffect(() => {
		let mounted = true;

		const initializeWhisper = async () => {
			try {
				if (!options.modelPath) {
					logger.warn('[useRealtimeTranscription] modelPath not provided in options');
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
					logger.info(`Realtime transcription initialized`);
				}

				if (options.autoStartRecording) {
					startRecording().catch(err => {
						logger.error(`Failed to auto-start recording`, { error: (err as Error).message });
					});
				}
			} catch (err) {
				const initError = err instanceof Error ? err : new Error(String(err));
				logger.error('[useRealtimeTranscription] Initialization failed:', initError);
				if (mounted) {
					setError(initError);
				}
			}
		};

		initializeWhisper();

		return () => {
			mounted = false;
		};
	}, [options.modelPath, options.useGpu, options.useCoreMLIos, options.useFlashAttn, options.useNnapi, options.useGpuDelegate, options.autoStartRecording, logger]);

	/**
	 * Start recording from microphone
	 */
	const startRecording = useCallback(async () => {
		try {
			logger.info(`Starting realtime transcription`);

			setError(null);
			setResult(null);
			setSegments([]);
			setInterimText('');
			audioBufferRef.current = [];
			metricsRef.current = {
				audioLevel: 0,
				chunksProcessed: 0,
				droppedChunks: 0,
				totalLatency: 0,
				latencyMeasurements: 0,
			};

			setIsConnected(true);
			setIsRecording(true);
			setIsPaused(false);

			logger.info(`Recording started`);
		} catch (err) {
			const recordingError = err instanceof Error ? err : new Error(String(err));
			setError(recordingError);
			logger.error(`Failed to start recording`, { error: recordingError.message });
		}
	}, [logger]);

	/**
	 * Stop recording and finalize transcription
	 */
	const stopRecording = useCallback(async () => {
		if (!isRecording) return;

		try {
			logger.info(`Stopping recording`);

			// Process any remaining audio in buffer
			if (audioBufferRef.current.length > 0) {
				const remainingAudio = AudioProcessing.concatenateAudioBuffers(audioBufferRef.current);
				await submitAudioChunk(remainingAudio);
			}

			setIsRecording(false);
			setIsConnected(false);

			logger.info(`Recording stopped`, {
				chunksProcessed: metricsRef.current.chunksProcessed,
			});
		} catch (err) {
			const stopError = err instanceof Error ? err : new Error(String(err));
			setError(stopError);
			logger.error(`Error stopping recording`, { error: stopError.message });
		}
	}, [isRecording]);

	/**
	 * Pause recording (keeps connection alive)
	 */
	const pauseRecording = useCallback(async () => {
		if (!isRecording || isPaused) return;

		try {
			logger.info(`Pausing recording`);
			setIsPaused(true);
		} catch (err) {
			const pauseError = err instanceof Error ? err : new Error(String(err));
			setError(pauseError);
			logger.error(`Error pausing recording`, { error: pauseError.message });
		}
	}, [isRecording, isPaused]);

	/**
	 * Resume recording after pause
	 */
	const resumeRecording = useCallback(async () => {
		if (!isRecording || !isPaused) return;

		try {
			logger.info(`Resuming recording`);
			setIsPaused(false);
		} catch (err) {
			const resumeError = err instanceof Error ? err : new Error(String(err));
			setError(resumeError);
			logger.error(`Error resuming recording`, { error: resumeError.message });
		}
	}, [isRecording, isPaused]);

	/**
	 * Submit audio chunk for processing
	 * Delegates to Whisper.transcribeBuffer() which handles native processing
	 */
	const submitAudioChunk = useCallback(
		async (audioData: Uint8Array) => {
			if (!whisperRef.current) {
				setError(new Error('Whisper not initialized'));
				return;
			}

			if (isPaused) {
				logger.debug(`Chunk received while paused, buffering`);
				audioBufferRef.current.push(audioData);
				return;
			}

			if (processingRef.current) {
				metricsRef.current.droppedChunks++;
				logger.warn(`Chunk dropped, previous chunk still processing`);
				updateMetrics();
				return;
			}

			try {
				processingRef.current = true;
				const chunkStartTime = Date.now();

				let isDetectingSilence = false;
				if (options.enableNoiseDetection) {
					isDetectingSilence = AudioProcessing.detectSilence(audioData, silenceThresholdDb);
				}

				logger.debug(`Processing audio chunk`, {
					size: audioData.length,
					isSilent: isDetectingSilence,
				});

				const task = await whisperRef.current.transcribeBuffer(audioData, {
					language: options.language,
					onProgress: () => {},
					onSegment: (segment: Segment) => {
						setSegments((prev) => [...prev, segment]);
						setInterimText((prev) => prev + (prev ? ' ' : '') + (segment.text || ''));

						logger.debug(`Segment received`, {
							text: segment.text,
						});
					},
				});

				if (task.result) {
					setResult(task.result);
				}

				metricsRef.current.chunksProcessed++;

				const latency = Date.now() - chunkStartTime;
				metricsRef.current.totalLatency += latency;
				metricsRef.current.latencyMeasurements++;

				updateMetrics();
			} catch (err) {
				const chunkError = err instanceof Error ? err : new Error(String(err));
				setError(chunkError);
				logger.error(`Error submitting audio chunk`, { error: chunkError.message });
			} finally {
				processingRef.current = false;
			}
		},
		[isPaused, options.language, options.enableNoiseDetection],
	);

	/**
	 * Update metrics state from ref
	 */
	const updateMetrics = useCallback(() => {
		const avgLatency =
			metricsRef.current.latencyMeasurements > 0
				? metricsRef.current.totalLatency / metricsRef.current.latencyMeasurements
				: 0;

		const droppedRate =
			metricsRef.current.chunksProcessed > 0
				? metricsRef.current.droppedChunks / metricsRef.current.chunksProcessed
				: 0;

		let bufferHealth: 'healthy' | 'warning' | 'critical';
		if (droppedRate > 0.1) {
			bufferHealth = 'critical';
		} else if (droppedRate > 0.05) {
			bufferHealth = 'warning';
		} else {
			bufferHealth = 'healthy';
		}

		setMetrics({
			audioLevel: metricsRef.current.audioLevel,
			chunksProcessed: metricsRef.current.chunksProcessed,
			droppedChunks: metricsRef.current.droppedChunks,
			averageLatencyMs: Math.round(avgLatency),
			isDetectingSilence: options.enableNoiseDetection ?? false,
			bufferHealth,
		});
	}, [options.enableNoiseDetection]);

	/**
	 * Clear interim text (for UI state reset)
	 */
	const clearInterimText = useCallback(() => {
		setInterimText('');
	}, []);

	/**
	 * Reset the entire session
	 */
	const resetSession = useCallback(() => {
		setIsConnected(false);
		setIsRecording(false);
		setIsPaused(false);
		setResult(null);
		setError(null);
		setSegments([]);
		setInterimText('');
		audioBufferRef.current = [];
		metricsRef.current = {
			audioLevel: 0,
			chunksProcessed: 0,
			droppedChunks: 0,
			totalLatency: 0,
			latencyMeasurements: 0,
		};

		logger.info(`Realtime session reset`);
	}, []);

	return {
		isConnected,
		isRecording,
		isPaused,
		result,
		error,
		segments,
		interimText,
		metrics,
		startRecording,
		stopRecording,
		pauseRecording,
		resumeRecording,
		submitAudioChunk,
		clearInterimText,
		resetSession,
	};
}
