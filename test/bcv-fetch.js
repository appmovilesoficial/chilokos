// Prueba rápida: Node puede leer la tasa del euro del BCV
(async () => {
  const t = Date.now();
  try {
    const res = await fetch('https://www.bcv.org.ve/estadisticas/tipo-de-cambio-de-referencia-0', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(25000),
    });
    const html = await res.text();
    const eur = html.match(/id="euro"[\s\S]{0,700}?strong-tb">\s*([0-9.,]+)/);
    const fecha = html.match(/Fecha Valor[\s\S]{0,300}?content="(\d{4}-\d{2}-\d{2})/);
    console.log('EUR:', eur && eur[1], '| FechaValor:', fecha && fecha[1], '| ms:', Date.now() - t);
  } catch (e) {
    console.log('FALLO:', e.message);
  }
})();
