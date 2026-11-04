/**
 * Voice Service & Speech Utilities.
 *
 * Implements:
 * 1. Web Speech API (SpeechRecognition) for voice question input.
 * 2. SpeechSynthesis for natural voice responses.
 * 3. Text cleaning: strips citation tokens like [doc p.N] and Markdown formatting
 *    before speech synthesis, preserving them in the written response.
 * 4. Safety & Privacy: Audio is processed client-side by browser APIs;
 *    no raw audio is ever stored or transmitted to server endpoints.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cleans Markdown and citation tokens for speech synthesis so the mascot
 * speaks naturally without reciting punctuation, code syntax, or citation markers.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove citation markers like [doc p.12], [doc p. 12], [doc p.12-14], [1], [2]
  cleaned = cleaned.replace(/\s*\[doc\s+p\.?\s*\d+(?:-\d+)?\]/gi, "");
  cleaned = cleaned.replace(/\s*\[\d+\]/g, "");

  // 2. Remove fenced code blocks (replace with brief spoken placeholder)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " code snippet ");

  // 3. Remove inline code backticks `code` -> code
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");

  // 4. Remove Markdown headers (### Header -> Header)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");

  // 5. Remove bold and italic markers (**text** or *text* or __text__ or _text_)
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  cleaned = cleaned.replace(/__([^_]+)__/g, "$1");
  cleaned = cleaned.replace(/_([^_]+)_/g, "$1");

  // 6. Convert Markdown links [Title](url) -> Title
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 7. Remove blockquotes and list markers (> quote, - item, * item, 1. item)
  cleaned = cleaned.replace(/^>\s+/gm, "");
  cleaned = cleaned.replace(/^[-*+]\s+/gm, "");
  cleaned = cleaned.replace(/^\d+\.\s+/gm, "");

  // 8. Remove raw HTML tags if any slipped through
  cleaned = cleaned.replace(/<[^>]*>/g, "");

  // 9. Normalize whitespace and clean spaces before punctuation
  cleaned = cleaned.replace(/\s+([.,;:!?])/g, "$1");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

export interface SpeechOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

export class SpeechService {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isMuted = false;

  public isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.cancel();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public getCurrentUtterance(): SpeechSynthesisUtterance | null {
    return this.currentUtterance;
  }

  public isSpeaking(): boolean {
    if (!this.isSupported()) return false;
    return window.speechSynthesis.speaking;
  }

  public isPaused(): boolean {
    if (!this.isSupported()) return false;
    return window.speechSynthesis.paused;
  }

  public pause(): void {
    if (this.isSupported() && this.isSpeaking()) {
      window.speechSynthesis.pause();
    }
  }

  public resume(): void {
    if (this.isSupported() && this.isPaused()) {
      window.speechSynthesis.resume();
    }
  }

  public cancel(): void {
    if (this.isSupported()) {
      window.speechSynthesis.cancel();
      this.currentUtterance = null;
    }
  }

  public speak(text: string, options: SpeechOptions = {}): SpeechSynthesisUtterance | null {
    if (!this.isSupported() || this.isMuted) {
      options.onEnd?.();
      return null;
    }

    const cleanedText = cleanTextForSpeech(text);
    if (!cleanedText) {
      options.onEnd?.();
      return null;
    }

    // Cancel any in-flight utterance first to avoid overlap
    this.cancel();

    try {
      const utterance = new SpeechSynthesisUtterance(cleanedText);
      utterance.rate = options.rate ?? 1.0;
      utterance.pitch = options.pitch ?? 1.0;
      utterance.volume = options.volume ?? 1.0;

      // Select an English voice if available
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const preferredVoice =
          voices.find((v) => v.lang.startsWith("en") && (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samantha"))) ||
          voices.find((v) => v.lang.startsWith("en")) ||
          voices[0];
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
      }

      utterance.onstart = () => {
        options.onStart?.();
      };

      utterance.onend = () => {
        this.currentUtterance = null;
        options.onEnd?.();
      };

      utterance.onerror = (e) => {
        this.currentUtterance = null;
        options.onError?.(e);
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
      return utterance;
    } catch (err) {
      console.warn("[SpeechService] Speech synthesis error:", err);
      options.onError?.(err);
      return null;
    }
  }
}

export const speechService = new SpeechService();

/**
 * Speech Recognition Hook
 * Provides microphone-driven voice input for the study companion using Web Speech API.
 */
export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const isSupported =
    typeof window !== "undefined" &&
    (Boolean((window as any).SpeechRecognition) || Boolean((window as any).webkitSpeechRecognition));

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore errors on stopping an already stopped instance
      }
    }
    setIsListening(false);
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setError(null);
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Speech recognition is not supported in this browser. Please type your message.");
      return;
    }

    // Stop any existing session
    stopListening();
    setError(null);

    try {
      const SpeechRecognitionClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognitionClass();

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item[0]?.transcript) {
            currentTranscript += item[0].transcript;
          }
        }
        setTranscript(currentTranscript);
      };

      recognition.onerror = (event: any) => {
        const errType = event.error;
        if (errType === "not-allowed" || errType === "service-not-allowed") {
          setError("Microphone permission was denied. Please allow microphone access to use voice input.");
        } else if (errType === "no-speech") {
          setError("No speech was detected. Please try speaking again.");
        } else if (errType === "network") {
          setError("Speech recognition network error. Please verify your connection.");
        } else {
          setError(`Speech recognition error (${errType || "unknown"}).`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setError(err?.message || "Could not start speech recognition.");
      setIsListening(false);
    }
  }, [isSupported, stopListening]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    isListening,
    transcript,
    error,
    startListening,
    stopListening,
    resetTranscript,
    setTranscript,
  };
}
