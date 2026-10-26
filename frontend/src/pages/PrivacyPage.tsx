import React, { useState } from "react";
import { PRODUCT_NAME, MASCOT_NAME } from "../brand";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import {
  ShieldCheck,
  Camera,
  Server,
  Trash2,
  Lock,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";

interface PrivacyPageProps {
  onBack: () => void;
}

export const PrivacyPage: React.FC<PrivacyPageProps> = ({ onBack }) => {
  const { logout } = useAuth();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteAccount();
      await logout();
    } catch (err: any) {
      setDeleteError(err?.message || "Failed to delete account. Please try again.");
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      {/* Header */}
      <header className="glass-panel border-b border-slate-800/80 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          <div className="flex items-center gap-2 text-indigo-600 font-bold tracking-tight">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>{PRODUCT_NAME} Privacy & Sovereignty</span>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white py-12 px-4 shadow-inner">
        <div className="max-w-4xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
            <Lock className="w-3.5 h-3.5" />
            Zero Raw Frame Telemetry & Local Processing
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Your Privacy & Data Rights</h1>
          <p className="text-slate-300 text-sm max-w-2xl leading-relaxed">
            {PRODUCT_NAME} is built with privacy-first engineering. We believe you shouldn't have to trade your personal boundaries to get world-class learning assistance.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 mt-8 space-y-8">
        {/* Core Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pillar 1: Camera */}
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
              <Camera className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Local Camera & 0 Raw Frames</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              When {MASCOT_NAME} monitors study posture, <strong>zero video frames ever leave your device</strong>. MediaPipe processes landmarks in a local Web Worker. Frames are wiped instantly from RAM.
            </p>
            <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
              <li>Webcam is OFF by default and completely optional</li>
              <li>Only anonymous numeric scores (e.g. attention, drowsiness) are computed</li>
              <li>Quality gate silences nudges in bad lighting</li>
            </ul>
          </div>

          {/* Pillar 2: AI & Cloud */}
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-700">
              <Server className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Third-Party AI Disclosure</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Course notes are partitioned into secure document chunks. When asking questions, relevant text excerpts are sent to hosted AI providers via encrypted TLS endpoints solely to generate answers.
            </p>
            <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
              <li>Strict delimiter wrapping protects against prompt injection</li>
              <li>We never log message content or uploaded note text</li>
              <li>System logs record only request latencies and token counts</li>
            </ul>
          </div>
        </div>

        {/* Detailed Sections */}
        <section className="bg-white rounded-xl p-8 border border-slate-200 shadow-sm space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">Complete Course Cascade Deletion</h3>
            <p className="text-sm text-slate-600 mt-1">
              Whenever you delete a course, our database performs an instant cascade purge: all original PDFs, document text chunks, vector embeddings, generated questions, quiz attempts, and chat messages are irreversibly removed from storage and disk.
            </p>
          </div>

          <hr className="border-slate-100" />

          <div>
            <h3 className="text-base font-bold text-slate-900">Anonymous Observability & Security</h3>
            <p className="text-sm text-slate-600 mt-1">
              Our backend auditing systems strictly track numerical telemetry (latency, token count, guardrail layer triggered). It is architecturally impossible for conversation text or document notes to be stored in our monitoring sinks.
            </p>
          </div>
        </section>

        {/* Danger Zone: Account Deletion */}
        <section className="bg-red-50/50 rounded-xl p-6 border border-red-200 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-red-100 text-red-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-red-950">Danger Zone: Delete Everything</h3>
              <p className="text-sm text-red-700/90 mt-1">
                You have the full right to be forgotten. Purging your account will immediately erase all courses, documents, sessions, flashcards, and your profile permanently.
              </p>
            </div>
          </div>

          <div className="pt-2">
            <button
              id="open-delete-account-modal"
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-sm transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete My Account & All Data
            </button>
          </div>
        </section>
      </main>

      {/* Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-lg font-bold text-slate-900">Are you absolutely sure?</h4>
              <p className="text-xs text-slate-500">
                This action is permanent and cannot be undone. All your courses, uploaded notes, quiz attempts, and progress records will be erased forever.
              </p>
            </div>

            {deleteError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200">
                {deleteError}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="confirm-delete-input" className="block text-xs font-semibold text-slate-700">
                Type <span className="font-mono text-red-600 font-bold">DELETE</span> to confirm:
              </label>
              <input
                id="confirm-delete-input"
                type="text"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmation("");
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="flex-1 py-2 px-3 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                id="confirm-delete-button"
                type="button"
                disabled={deleteConfirmation !== "DELETE" || isDeleting}
                onClick={handleDeleteAccount}
                className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {isDeleting ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
