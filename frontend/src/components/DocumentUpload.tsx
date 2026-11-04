import React, { useRef, useState, useEffect } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Document } from "../types";
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
  const [loadingDocs, setLoadingDocs] = useState<boolean>(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing course documents on mount and courseId change
  useEffect(() => {
    let isMounted = true;
    const fetchDocuments = async () => {
      try {
        setLoadingDocs(true);
        const docs = await api.getCourseDocuments(courseId);
        if (isMounted) {
          setDocuments(docs);
        }
      } catch (err) {
        console.error("Failed to load documents for course:", err);
      } finally {
        if (isMounted) {
          setLoadingDocs(false);
        }
      }
    };

    fetchDocuments();

    return () => {
      isMounted = false;
    };
  }, [courseId]);

  // Sync initialDocuments if parent passes non-empty list
  useEffect(() => {
    if (initialDocuments && initialDocuments.length > 0) {
      setDocuments(initialDocuments);
    }
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
    }, 2000);

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

  const [reprocessingId, setReprocessingId] = useState<number | null>(null);

  const handleReprocess = async (docId: number) => {
    try {
      setReprocessingId(docId);
      setError(null);
      const updated = await api.reprocessDocument(courseId, docId);
      setDocuments((prev) => prev.map((d) => (d.id === docId ? updated : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reprocess document");
    } finally {
      setReprocessingId(null);
    }
  };

  const renderStatusBadge = (doc: Document) => {
    if (doc.status === "ready" && (doc.chunks_count ?? 0) > 0) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-semibold text-[#0D9488] bg-[#F0FDFA] border border-teal-200 px-2.5 py-0.5 rounded-pill">
          <CheckCircle2 className="w-3 h-3" /> Ready ({doc.chunks_count} chunks)
        </span>
      );
    }
    if (doc.status === "ready" && (doc.chunks_count ?? 0) === 0) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-semibold text-[#D97706] bg-[#FFFBEB] border border-amber-200 px-2.5 py-0.5 rounded-pill">
          <AlertCircle className="w-3 h-3" /> No Chunks
        </span>
      );
    }
    if (doc.status === "processing" || reprocessingId === doc.id) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-semibold text-[#4F46E5] bg-[#EEF2FF] border border-indigo-200 px-2.5 py-0.5 rounded-pill">
          <Loader2 className="w-3 h-3 animate-spin" /> Ingesting & Indexing
        </span>
      );
    }
    if (doc.status === "failed" || doc.status === "error") {
      return (
        <span className="flex items-center gap-1 text-[11px] font-semibold text-[#E11D48] bg-[#FFF1F2] border border-rose-200 px-2.5 py-0.5 rounded-pill">
          <AlertCircle className="w-3 h-3" /> Failed
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-[#D97706] bg-[#FFFBEB] border border-amber-200 px-2.5 py-0.5 rounded-pill">
        <Clock className="w-3 h-3 animate-pulse" /> Queued
      </span>
    );
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
        className={`bg-white rounded-2xl p-8 text-center cursor-pointer border-2 border-dashed transition-all shadow-sm ${
          dragActive
            ? "border-[#4F46E5] bg-[#EEF2FF]/60 scale-[1.01]"
            : "border-[#E2E8F0] hover:border-[#4F46E5] hover:bg-[#EEF2FF]/20"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center text-[#4F46E5] mb-4">
          {uploading ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : (
            <UploadCloud className="w-7 h-7" />
          )}
        </div>

        <h4 className="text-sm font-bold text-[#0F172A] mb-1">
          {uploading ? "Uploading & queuing document..." : "Upload course syllabus or study materials"}
        </h4>
        <p className="text-xs text-[#64748B] max-w-sm mx-auto">
          Drag and drop PDF textbooks, lecture slides, or markdown notes (up to 25MB).
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-[#FFF1F2] border border-rose-200 text-[#E11D48] text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Uploaded Documents List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-[#0F172A] uppercase tracking-wider">
            Uploaded Materials ({documents.length})
          </h4>
        </div>

        {loadingDocs ? (
          <div className="p-6 rounded-xl border border-[#E2E8F0] bg-white text-center text-xs text-[#64748B] flex items-center justify-center gap-2 shadow-sm">
            <Loader2 className="w-4 h-4 animate-spin text-[#4F46E5]" />
            <span>Loading course materials...</span>
          </div>
        ) : documents.length === 0 ? (
          <div className="p-6 rounded-xl border border-[#E2E8F0] bg-white text-center text-xs text-[#64748B] shadow-sm">
            No documents uploaded yet. Upload a PDF or notes file to get started.
          </div>
        ) : (
          <div className="space-y-2.5">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="bg-white rounded-xl p-4 flex items-center justify-between gap-3 border border-[#E2E8F0] shadow-sm hover:shadow-card-hover transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#EEF2FF] border border-indigo-100 flex items-center justify-center shrink-0 text-[#4F46E5]">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A] truncate max-w-xs sm:max-w-md">
                      {doc.filename || `Document #${doc.id}`}
                    </p>
                    <p className="text-[11px] text-[#64748B]">
                      {doc.size_bytes ? `${(doc.size_bytes / 1024).toFixed(1)} KB • ` : ""}
                      {doc.pages ? `${doc.pages} pages • ` : ""}
                      {doc.chunks_count !== undefined ? `${doc.chunks_count} chunks • ` : ""}
                      {new Date(doc.created_at).toLocaleDateString()}
                    </p>
                    {doc.error && (
                      <p className="text-[11px] text-[#E11D48] mt-0.5 truncate max-w-xs sm:max-w-md">
                        {doc.error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {renderStatusBadge(doc)}
                  <button
                    onClick={() => handleReprocess(doc.id)}
                    disabled={reprocessingId === doc.id || doc.status === "processing"}
                    title="Reprocess document"
                    className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition disabled:opacity-40 text-xs font-semibold min-h-[44px]"
                  >
                    Reprocess
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
