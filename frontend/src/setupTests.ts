import "@testing-library/jest-dom";

// Mock Web Speech API SpeechSynthesis
if (typeof window !== "undefined") {
  const mockSpeechSynthesis = {
    speaking: false,
    paused: false,
    speak: vi.fn((utterance: any) => {
      mockSpeechSynthesis.speaking = true;
      setTimeout(() => {
        mockSpeechSynthesis.speaking = false;
        utterance.onend?.();
      }, 10);
    }),
    cancel: vi.fn(() => {
      mockSpeechSynthesis.speaking = false;
      mockSpeechSynthesis.paused = false;
    }),
    pause: vi.fn(() => {
      mockSpeechSynthesis.paused = true;
    }),
    resume: vi.fn(() => {
      mockSpeechSynthesis.paused = false;
    }),
    getVoices: vi.fn(() => [
      { name: "Google US English", lang: "en-US", default: true },
    ]),
  };

  Object.defineProperty(window, "speechSynthesis", {
    value: mockSpeechSynthesis,
    writable: true,
  });

  class MockSpeechSynthesisUtterance {
    text: string;
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: any = null;
    onstart: any = null;
    onend: any = null;
    onerror: any = null;
    constructor(text = "") {
      this.text = text;
    }
  }

  (window as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

  // Mock SpeechRecognition
  class MockSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = "en-US";
    onstart: (() => void) | null = null;
    onresult: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onend: (() => void) | null = null;

    start() {
      setTimeout(() => {
        if (typeof this.onstart === "function") {
          this.onstart();
        }
      }, 0);
    }

    stop() {
      setTimeout(() => {
        if (typeof this.onend === "function") {
          this.onend();
        }
      }, 0);
    }

    abort() {
      setTimeout(() => {
        if (typeof this.onend === "function") {
          this.onend();
        }
      }, 0);
    }
  }

  (window as any).SpeechRecognition = MockSpeechRecognition;
  (window as any).webkitSpeechRecognition = MockSpeechRecognition;
}
