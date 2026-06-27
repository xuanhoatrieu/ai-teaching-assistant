import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';

interface JobStatus {
    id: string;
    type: string;
    status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
    progress: number;
    total: number;
    message: string | null;
    error: string | null;
    createdAt: string;
}

interface UseJobPollingReturn {
    /** Current job status object */
    jobStatus: JobStatus | null;
    /** Whether a job is currently in progress */
    isRunning: boolean;
    /** Start polling a specific job */
    startPolling: (jobId: string) => void;
    /** Stop polling (auto-stops on done/error) */
    stopPolling: () => void;
    /** Error message if job failed */
    errorMessage: string | null;
}

/**
 * Generic hook for polling generation job status.
 * Usage:
 *   const { startPolling, isRunning, jobStatus, errorMessage } = useJobPolling({
 *       onComplete: () => { loadData(); },
 *       onError: (msg) => { alert(msg); },
 *   });
 *
 *   // After POST returns { jobId }:
 *   startPolling(jobId);
 */
export function useJobPolling(options?: {
    /** Called when job completes successfully */
    onComplete?: (jobStatus: JobStatus) => void;
    /** Called when job fails */
    onError?: (errorMessage: string) => void;
    /** Called when job was cancelled by the user */
    onCancelled?: () => void;
    /** Polling interval in ms (default: 3000) */
    intervalMs?: number;
}): UseJobPollingReturn {
    const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const jobIdRef = useRef<string | null>(null);
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const stopPolling = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        jobIdRef.current = null;
        setIsRunning(false);
    }, []);

    const pollOnce = useCallback(async (jobId: string) => {
        try {
            const response = await api.get(`/generation-jobs/${jobId}/status`);
            const status: JobStatus = response.data;
            setJobStatus(status);

            if (status.status === 'done') {
                stopPolling();
                optionsRef.current?.onComplete?.(status);
            } else if (status.status === 'cancelled') {
                stopPolling();
                optionsRef.current?.onCancelled?.();
            } else if (status.status === 'error') {
                stopPolling();
                const msg = status.error || 'Đã xảy ra lỗi không xác định';
                setErrorMessage(msg);
                optionsRef.current?.onError?.(msg);
            }
        } catch (err: any) {
            console.error('[useJobPolling] Poll error:', err);
            // Don't stop polling on network errors — could be temporary
        }
    }, [stopPolling]);

    const startPolling = useCallback((jobId: string) => {
        // Clear any existing polling
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        jobIdRef.current = jobId;
        setIsRunning(true);
        setErrorMessage(null);
        setJobStatus({
            id: jobId,
            type: '',
            status: 'pending',
            progress: 0,
            total: 0,
            message: 'Đang khởi tạo...',
            error: null,
            createdAt: new Date().toISOString(),
        });

        // First poll immediately
        pollOnce(jobId);

        // Then poll at interval
        const interval = optionsRef.current?.intervalMs || 3000;
        intervalRef.current = setInterval(() => {
            if (jobIdRef.current) {
                pollOnce(jobIdRef.current);
            }
        }, interval);
    }, [pollOnce]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, []);

    return {
        jobStatus,
        isRunning,
        startPolling,
        stopPolling,
        errorMessage,
    };
}
