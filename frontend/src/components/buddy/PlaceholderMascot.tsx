/**
 * Visual Mascot Renderer for the Study Companion.
 * Implements full state-machine facial expressions, cursor-following pupils, and micro-animations.
 * Uses MascotRenderer interface matching future Rive state machine inputs.
 */

import React, { useEffect, useState } from "react";
import { BuddyState } from "../../buddy/types";

export interface MascotRendererProps {
  state: BuddyState;
  isTalking?: boolean;
  onTap?: () => void;
  className?: string;
}

export const PlaceholderMascot: React.FC<MascotRendererProps> = ({
  state,
  isTalking = false,
  onTap,
  className = "w-36 h-36",
}) => {
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });
  const [isTapped, setIsTapped] = useState(false);

  // 1. Mouse cursor eye tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Calculate relative pupil offset (-4 to +4 pixels)
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const normX = (e.clientX - centerX) / (window.innerWidth / 2);
      const normY = (e.clientY - centerY) / (window.innerHeight / 2);

      const lookX = Math.max(-4, Math.min(4, normX * 4));
      const lookY = Math.max(-4, Math.min(4, normY * 4));
      setPupilOffset({ x: lookX, y: lookY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const handleClick = () => {
    setIsTapped(true);
    setTimeout(() => setIsTapped(false), 400);
    onTap?.();
  };

  // State-specific visual parameters
  const isTilted = state === "curious_check";
  const isCelebrating = state === "celebrate";
  const isSleeping = state === "sleepy" || state === "rest";
  const isStudying = state === "studying" || state === "deep_focus";
  const isBreak = state === "break_time";
  const isAway = state === "away";

  return (
    <div
      onClick={handleClick}
      className={`relative cursor-pointer select-none transition-transform duration-300 ease-out ${
        isTapped ? "scale-95" : isCelebrating ? "animate-bounce" : "hover:scale-105"
      } ${isAway ? "opacity-40 grayscale" : "opacity-100"} ${className}`}
      style={{
        transform: isTilted ? "rotate(14deg) translateY(-2px)" : undefined,
      }}
      title="Click to interact with study companion"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
    >
      <svg
        viewBox="0 0 120 120"
        className="w-full h-full drop-shadow-xl"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="mascotGlow" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="70%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#3730a3" />
          </radialGradient>
          <linearGradient id="cheekGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#fb7185" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="glassesFrame" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
        </defs>

        {/* Ambient shadow */}
        <ellipse cx="60" cy="112" rx="34" ry="7" fill="black" fillOpacity="0.25" />

        {/* Mascot Body: Friendly curved blob */}
        <path
          d="M 60 14 C 88 14 104 36 104 68 C 104 96 86 108 60 108 C 34 108 16 96 16 68 C 16 36 32 14 60 14 Z"
          fill="url(#mascotGlow)"
        />

        {/* Belly highlight */}
        <path
          d="M 60 48 C 76 48 86 64 86 82 C 86 98 74 104 60 104 C 46 104 34 98 34 82 C 34 64 44 48 60 48 Z"
          fill="#c7d2fe"
          fillOpacity="0.18"
        />

        {/* Rosy Cheeks */}
        <circle cx="34" cy="74" r="7" fill="url(#cheekGlow)" />
        <circle cx="86" cy="74" r="7" fill="url(#cheekGlow)" />

        {/* EYES */}
        {isSleeping ? (
          // Sleeping/Resting Eyes: Happy calm curves (^ ^)
          <g stroke="#ffffff" strokeWidth="3" strokeLinecap="round">
            <path d="M 38 64 Q 44 58 50 64" />
            <path d="M 70 64 Q 76 58 82 64" />
          </g>
        ) : isCelebrating ? (
          // Celebrating Star/Happy Eyes (><)
          <g stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round">
            <path d="M 37 60 L 49 68 M 49 60 L 37 68" />
            <path d="M 71 60 L 83 68 M 83 60 L 71 68" />
          </g>
        ) : (
          // Normal Open Eyes with Cursor-Tracking Pupils
          <g>
            {/* White eye sclera */}
            <ellipse cx="44" cy="62" rx="9" ry="12" fill="#ffffff" />
            <ellipse cx="76" cy="62" rx="9" ry="12" fill="#ffffff" />

            {/* Dark pupils with cursor translation */}
            <g transform={`translate(${pupilOffset.x}, ${pupilOffset.y})`}>
              <ellipse cx="44" cy="62" rx="5.5" ry="7" fill="#1e1b4b" />
              <ellipse cx="76" cy="62" rx="5.5" ry="7" fill="#1e1b4b" />
              {/* Catchlight sparkle */}
              <circle cx="46" cy="59" r="2.2" fill="#ffffff" />
              <circle cx="78" cy="59" r="2.2" fill="#ffffff" />
            </g>
          </g>
        )}

        {/* Study Glasses accessory when studying */}
        {isStudying && (
          <g stroke="url(#glassesFrame)" strokeWidth="2.5" fill="none">
            <circle cx="44" cy="62" r="14" fill="#60a5fa" fillOpacity="0.15" />
            <circle cx="76" cy="62" r="14" fill="#60a5fa" fillOpacity="0.15" />
            <line x1="58" y1="62" x2="62" y2="62" />
          </g>
        )}

        {/* MOUTH */}
        {isTalking ? (
          // Animated talking mouth
          <ellipse cx="60" cy="80" rx="6" ry="7" fill="#be185d" />
        ) : isCelebrating ? (
          // Joyful open grin
          <path d="M 50 78 Q 60 92 70 78 Z" fill="#fda4af" stroke="#be185d" strokeWidth="1.5" />
        ) : isBreak ? (
          // Gentle warm smile
          <path d="M 52 79 Q 60 85 68 79" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
        ) : (
          // Default friendly smile
          <path d="M 53 78 Q 60 84 67 78" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
        )}

        {/* Celebratory sparkles */}
        {isCelebrating && (
          <g fill="#fbbf24">
            <path d="M 22 36 L 25 39 L 22 42 L 19 39 Z" />
            <path d="M 98 32 L 101 35 L 98 38 L 95 35 Z" />
            <path d="M 60 6 L 63 9 L 60 12 L 57 9 Z" />
          </g>
        )}

        {/* Sleeping "Z z Z" bubbles */}
        {isSleeping && (
          <g fill="#a5b4fc" fontWeight="bold" fontSize="11" fontFamily="sans-serif">
            <text x="88" y="44">z</text>
            <text x="96" y="32">Z</text>
          </g>
        )}

        {/* Break cup / steam */}
        {isBreak && (
          <g transform="translate(86, 76)">
            <rect x="0" y="8" width="14" height="12" rx="3" fill="#38bdf8" />
            <path d="M 14 11 Q 18 14 14 17" stroke="#38bdf8" strokeWidth="2" fill="none" />
            <path d="M 4 5 Q 7 2 5 0" stroke="#bae6fd" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </g>
        )}
      </svg>
    </div>
  );
};
