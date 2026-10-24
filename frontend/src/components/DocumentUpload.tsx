import React, { useRef, useState, useEffect } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Document, DocumentStatus } from "../types";
import { api } from "../services/api";

interface DocumentUploadProps {
  courseId: number;
  initialDocuments?: Document[];
  onDocumentUploaded?: (doc: Document) => void;
}

export const DocumentUpload: React.FC<DocumentUploadProps> = ({
  courseId,
  initialDocuments = [],
  onDocumentUploaded,
}) => {
  const [documents, setDocuments] = useState<Document[]>(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync initialDocuments if parent updates
  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  // Polling for documents in queued or processing status
  useEffect(() => {
    const pendingDocs = documents.filter(
      (d) => d.status === "queued" || d.status === "processing"
    );

    if (pendingDocs.length === 0) return;

    const interval = setInterval(async () => {
      try {
        const updatedDocs = await Promise.all(
          documents.map(async (doc) => {
            if (doc.status === "queued" || doc.status === "processing") {
              try {
                const refreshed = await api.getDocument(doc.id);
                return refreshed;
              } catch {
                return doc;
              }
            }
            return doc;
          })
        );
        setDocuments(updatedDocs);
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [documents]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    // Validate size (25MB limit)
    const MAX_SIZE = 25 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setError("File exceeds maximum allowed size of 25MB");
      return;
    }

    // Validate type (PDF or plain text)
    const allowedTypes = ["application/pdf", "text/plain"];
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const isTxt = file.name.toLowerCase().endsWith(".txt");
    if (!allowedTypes.includes(file.type) && !isPdf && !isTxt) {
      setError("Unsupported file format. Please upload a PDF or plain text file.");
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const newDoc = await api.uploadDocument(courseId, file);
      setDocuments((prev) => [newDoc, ...prev]);
      if (onDocumentUploaded) {
        onDocumentUploaded(newDoc);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const renderStatusBadge = (status: DocumentStatus) => {
    switch (status) {
      case "indexed":
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" /> Indexed
          </span>
        );
      case "processing":
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
            <Loader2 className="w-3 h-3 animate-spin" /> Processing
          </span>
        );
      case "error":
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
            <AlertCircle className="w-3 h-3" /> Failed
          </span>
        );
      case "queued":
      default:
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
            <Clock className="w-3 h-3 animate-pulse" /> Queued
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Dropzone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`glass-card rounded-2xl p-8 text-center cursor-pointer border-2 border-dashed transition-all ${
          dragActive
            ? "border-brand-500 bg-brand-500/10 scale-[1.01]"
            : "border-slate-800 hover:border-brand-500/50 hover:bg-slate-900/40"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400 shadow-inner mb-4">
          {uploading ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : (
            <UploadCloud className="w-7 h-7" />
          )}
        </div>

        <h4 className="text-sm font-bold text-white mb-1">
          {uploading ? "Uploading & queuing document..." : "Upload course syllabus or study materials"}
        </h4>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          Drag and drop PDF textbooks, lecture slides, or markdown notes (up to 25MB).
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Uploaded Documents List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Uploaded Materials ({documents.length})
          </h4>
        </div>

        {documents.length === 0 ? (
          <div className="p-6 rounded-xl border border-slate-800/80 bg-slate-950/40 text-center text-xs text-slate-500">
            No documents uploaded yet. Upload a PDF or notes file to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="glass-card rounded-xl p-3.5 flex items-center justify-between gap-3 border border-slate-800/80"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 text-slate-400">
                    <FileText className="w-4 h-4 text-brand-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate max-w-xs sm:max-w-md">
                      {doc.filename}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {(doc.size_bytes / 1024).toFixed(1)} KB • {new Date(doc.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="shrink-0">{renderStatusBadge(doc.status)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
