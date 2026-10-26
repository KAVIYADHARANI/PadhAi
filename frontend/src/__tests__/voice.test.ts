import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanTextForSpeech, speechService } from "../services/voice";

describe("Voice Utilities and SpeechService", () => {
  beforeEach(() => {
    speechService.cancel();
    speechService.setMuted(false);
    vi.clearAllMocks();
  });

  describe("cleanTextForSpeech", () => {
    it("strips citation tokens like [doc p.12], [doc p. 3], [doc p.10-15], and numeric markers [1]", () => {
      const rawText =
        "The gradient descent equation is derived from calculus [doc p.12]. For learning rates, see [doc p. 3] and [1].";
      const cleaned = cleanTextForSpeech(rawText);
      expect(cleaned).not.toContain("[doc p.12]");
      expect(cleaned).not.toContain("[doc p. 3]");
      expect(cleaned).not.toContain("[1]");
      expect(cleaned).toBe(
        "The gradient descent equation is derived from calculus. For learning rates, see and."
      );
    });

    it("strips Markdown syntax such as headers, bold, italics, inline code, and code blocks", () => {
      const markdown = `
### Core Concepts
Here is **important** information about *neural networks*.
Use the \`sigmoid\` function as shown below:
\`\`\`python
def sigmoid(x):
    return 1 / (1 + exp(-x))
\`\`\`
> Remember to normalize inputs!
- Step 1: scale
- Step 2: train
      `;
      const cleaned = cleanTextForSpeech(markdown);
      expect(cleaned).not.toContain("###");
      expect(cleaned).not.toContain("**");
      expect(cleaned).not.toContain("*neural");
      expect(cleaned).not.toContain("`sigmoid`");
      expect(cleaned).not.toContain("def sigmoid");
      expect(cleaned).toContain("Core Concepts");
      expect(cleaned).toContain("important information about neural networks");
      expect(cleaned).toContain("Use the sigmoid function");
      expect(cleaned).toContain("code snippet");
      expect(cleaned).toContain("Remember to normalize inputs!");
    });

    it("converts Markdown links [Title](url) to plain text title", () => {
      const input = "Read more in the [Official Docs](https://example.com/docs).";
      const cleaned = cleanTextForSpeech(input);
      expect(cleaned).toBe("Read more in the Official Docs.");
    });

    it("handles empty or falsy inputs gracefully", () => {
      expect(cleanTextForSpeech("")).toBe("");
      expect(cleanTextForSpeech("   ")).toBe("");
    });
  });

  describe("speechService", () => {
    it("reports speech synthesis support", () => {
      expect(speechService.isSupported()).toBe(true);
    });

    it("speaks cleaned text using SpeechSynthesis", () => {
      const text = "Hello learner! See [doc p.4] for details.";
      const onStart = vi.fn();
      const onEnd = vi.fn();

      speechService.speak(text, { onStart, onEnd });
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
      const calledUtterance = (window.speechSynthesis.speak as any).mock.calls[0][0];
      expect(calledUtterance.text).toBe("Hello learner! See for details.");
    });

    it("cancels speech and respects muted state", () => {
      speechService.setMuted(true);
      expect(speechService.getMuted()).toBe(true);
      expect(window.speechSynthesis.cancel).toHaveBeenCalled();

      const result = speechService.speak("Should not speak");
      expect(result).toBeNull();
    });

    it("supports pause and resume", () => {
      (window.speechSynthesis as any).speaking = true;
      speechService.pause();
      expect(window.speechSynthesis.pause).toHaveBeenCalled();

      (window.speechSynthesis as any).paused = true;
      speechService.resume();
      expect(window.speechSynthesis.resume).toHaveBeenCalled();
    });
  });
});
