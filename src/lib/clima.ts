// src/lib/clima.ts
// Clima real del Dashboard, vía Open-Meteo (no requiere API key). Si la
// empresa no configuró coordenadas (Company.climaLat/climaLon), o si la
// consulta falla, se devuelve null — el Dashboard debe mostrar "Clima no
// configurado"/"No disponible" en vez de inventar una temperatura o
// condición.

export interface ClimaActual {
  tempC: number;
  codigo: number;
  descripcion: string;
}

// Códigos WMO usados por Open-Meteo (https://open-meteo.com/en/docs), agrupados a una descripción corta en español.
function describirCodigo(codigo: number): string {
  if (codigo === 0) return 'Despejado';
  if ([1, 2].includes(codigo)) return 'Parcialmente nublado';
  if (codigo === 3) return 'Nublado';
  if ([45, 48].includes(codigo)) return 'Neblina';
  if ([51, 53, 55, 56, 57].includes(codigo)) return 'Llovizna';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(codigo)) return 'Lluvia';
  if ([71, 73, 75, 77, 85, 86].includes(codigo)) return 'Nieve';
  if ([95, 96, 99].includes(codigo)) return 'Tormenta';
  return 'Variable';
}

export async function getClimaActual(lat: number, lon: number): Promise<ClimaActual | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
    const res = await fetch(url, { next: { revalidate: 600 } }); // 10 min: el clima no cambia mas rapido que eso para este uso
    if (!res.ok) return null;
    const data = await res.json();
    const actual = data?.current_weather;
    if (!actual || typeof actual.temperature !== 'number') return null;
    return {
      tempC: Math.round(actual.temperature),
      codigo: actual.weathercode,
      descripcion: describirCodigo(actual.weathercode),
    };
  } catch (err) {
    console.error('No se pudo obtener el clima:', err);
    return null;
  }
}
