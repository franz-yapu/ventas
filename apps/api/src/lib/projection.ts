export interface TrendPoint {
  date: string;
  total: number;
}

export interface Projection {
  nextMonth: string;
  low: string;
  high: string;
  avgDaily: string;
  method: string;
}

/**
 * Proyección simple del próximo mes: regresión lineal sobre las ventas diarias
 * + banda de confianza a partir del error estándar. Sin ML pesado.
 */
export function computeProjection(trend: TrendPoint[]): Projection {
  const ys = trend.map((t) => t.total);
  const n = ys.length;
  if (n < 3) {
    const avg = n ? ys.reduce((a, b) => a + b, 0) / n : 0;
    const monthly = avg * 30;
    return {
      nextMonth: monthly.toFixed(2),
      low: monthly.toFixed(2),
      high: monthly.toFixed(2),
      avgDaily: avg.toFixed(2),
      method: 'promedio (datos insuficientes)',
    };
  }

  // Regresión lineal least squares: y = m*x + b
  const xs = ys.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i]!, 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  const m = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;

  // Proyectar los próximos 30 días y sumar.
  let projected = 0;
  for (let i = n; i < n + 30; i++) projected += Math.max(0, m * i + b);

  // Error estándar de los residuos -> banda ±.
  const residuals = ys.map((y, i) => y - (m * i + b));
  const rss = residuals.reduce((a, r) => a + r * r, 0);
  const stdErr = Math.sqrt(rss / Math.max(1, n - 2));
  const band = stdErr * Math.sqrt(30); // acumulado en 30 días

  const avgDaily = sumY / n;
  return {
    nextMonth: projected.toFixed(2),
    low: Math.max(0, projected - band).toFixed(2),
    high: (projected + band).toFixed(2),
    avgDaily: avgDaily.toFixed(2),
    method: 'regresión lineal (30 días)',
  };
}
