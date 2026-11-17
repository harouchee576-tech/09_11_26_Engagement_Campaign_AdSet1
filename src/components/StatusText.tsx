import { AlertCircle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import type { JobStatus } from '../types';

export function JobStatusLabel({ status }: { status: JobStatus | 'draft' | 'producing' }) {
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Terminé
        </span>
      );
    case 'processing':
    case 'producing':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 whitespace-nowrap">
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          En cours
        </span>
      );
    case 'queued':
    case 'draft':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          En file
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Échec
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          Annulé
        </span>
      );
  }
}
