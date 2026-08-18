'use client';

// src/components/etiquetas/label-preview.tsx
// Vista previa de una etiqueta individual, renderizada en el navegador
// con bwip-js (misma libreria que usa el servidor para el PDF, para que
// la vista previa sea fiel). Code128 (1D) unicamente, nunca QR.
import * as React from 'react';

interface LabelPreviewProps {
  code: string;
  fecha: string;
}

function fmtFechaCorta(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

export function LabelPreview({ code, fecha }: LabelPreviewProps) {
  const [svg, setSvg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let activo = true;
    import('bwip-js/browser')
      .then((bwipjs) => {
        if (!activo) return;
        try {
          const markup = bwipjs.toSVG({ bcid: 'code128', text: code, scale: 2, height: 10, includetext: false });
          setSvg(markup);
        } catch {
          setSvg(null);
        }
      })
      .catch(() => setSvg(null));
    return () => {
      activo = false;
    };
  }, [code]);

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-center">
      <p className="font-mono text-sm font-bold leading-tight text-ink dark:text-gray-100">{code}</p>
      {svg ? (
        <div className="h-8 w-full max-w-[150px] [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="h-8 w-full max-w-[150px] animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      )}
      <p className="text-[10px] text-gray-400 dark:text-gray-500">{fmtFechaCorta(fecha)}</p>
    </div>
  );
}
