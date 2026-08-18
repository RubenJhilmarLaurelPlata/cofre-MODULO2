'use client';

// src/components/etiquetas/etiqueta-preview-card.tsx
// Vista previa de una etiqueta individual fiel al PDF real: mismo
// aspecto de celda (195.37 x 76.61pt, ver src/lib/etiquetas-pdf.ts),
// mismo borde, mismo codigo grande en negrita, mismo Code128 (bwip-js,
// igual libreria que usa el servidor) y la misma fecha en una sola linea
// debajo del barcode. Usa container queries (cqw) para que el tamaño de
// letra escale con el ancho real de la tarjeta sin importar cuantas
// columnas tenga la grilla en cada breakpoint.
import * as React from 'react';

interface EtiquetaPreviewCardProps {
  code: string;
  fecha: string; // YYYY-MM-DD
}

function fmtFechaEtiqueta(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

export function EtiquetaPreviewCard({ code, fecha }: EtiquetaPreviewCardProps) {
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
    <div
      className="flex flex-col items-center justify-between overflow-hidden border-[1.75px] border-black bg-white px-[3cqh] py-[3cqh] [container-type:size]"
      style={{ aspectRatio: '195.37 / 76.61' }}
    >
      <p className="w-full truncate text-center font-bold leading-none tracking-tight text-black text-[24cqh]">{code}</p>
      {svg ? (
        <div className="h-[28cqh] w-[80%] [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="h-[28cqh] w-[80%] animate-pulse bg-gray-100" />
      )}
      <p className="whitespace-nowrap text-center text-[9cqh] leading-none text-gray-700">
        Fecha de ingreso: {fmtFechaEtiqueta(fecha)}
      </p>
    </div>
  );
}
