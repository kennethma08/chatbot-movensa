import Chart, { type ChartConfiguration, type ChartType } from 'chart.js/auto';
import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { Content, TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';

const pdfMake = pdfMakeModule as typeof pdfMakeModule & { vfs: Record<string, string> };
pdfMake.vfs = pdfFonts as unknown as Record<string, string>;
const poppinsRegular = new URL('/fonts/Poppins-Regular.ttf', window.location.origin).href;
const poppinsBold = new URL('/fonts/Poppins-Bold.ttf', window.location.origin).href;
const poppinsFonts: TFontDictionary = {
  Poppins: {
    normal: poppinsRegular,
    bold: poppinsBold,
    italics: poppinsRegular,
    bolditalics: poppinsBold,
  },
};

type Overview = {
  total_messages: number; closed: number; new_clients: number; open_conversations: number;
  active_clients: number; active_countries: number; messages_per_conversation: number | null;
  average_first_response_seconds: number | null; average_resolution_minutes: number | null;
  sla_under_five_rate: number | null; escalated_conversations: number;
};

type TeamRow = {
  name: string; email: string; closed_conversations: number; handled_conversations: number;
  open_load: number; sent_messages: number; average_first_response_seconds: number | null;
  average_resolution_minutes: number | null; sla_under_five_rate: number | null;
};

export type GeneralPdfReport = {
  overview: Overview;
  series: Array<{ day: string; messages: number }>;
  countries: Array<{ country: string; count: number }>;
  channels?: Array<{ channel: string; count: number }>;
  topClients: Array<{ name: string; phone_number: string; messages: number }>;
  team: TeamRow[];
};

export type AgentPdfData = {
  agent: TeamRow & { status: boolean; is_online: boolean; last_activity: string | null };
  closures: Array<{
    contact_phone: string; started_at: string; ended_at: string;
    first_response_minutes: number | null; duration_minutes: number | null;
  }>;
  from: string;
  to: string;
};

const number = (value: unknown) => Number(value ?? 0).toLocaleString('es-CR');
const metric = (value: unknown, suffix = '') => value === null || value === undefined ? `0${suffix}` : `${typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : number(value)}${suffix}`;
const minutesFromSeconds = (value: number | null) => value === null ? 0 : value / 60;
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date(value)) : 'N/D';
const slug = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function dataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function chartImage<TType extends ChartType>(configuration: ChartConfiguration<TType>, width = 960, height = 340): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const chart = new Chart(context, {
    ...configuration,
    options: {
      responsive: false,
      animation: false,
      maintainAspectRatio: false,
      ...configuration.options,
    } as ChartConfiguration<TType>['options'],
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const image = canvas.toDataURL('image/png', 1);
  chart.destroy();
  return image;
}

function metricCards(cards: Array<{ label: string; value: string; hint: string }>): Content {
  const rows: Content[][] = [];
  for (let index = 0; index < cards.length; index += 3) {
    const group = cards.slice(index, index + 3);
    while (group.length < 3) group.push({ label: '', value: '', hint: '' });
    rows.push(group.map((card) => card.label ? ({
      stack: [
        { text: card.label, fontSize: 9, color: '#69558e', bold: true, margin: [0, 0, 0, 4] },
        { text: card.value, fontSize: 17, color: '#2d1848', bold: true },
        { text: card.hint, fontSize: 8, color: '#8e7ea9', margin: [0, 4, 0, 0] },
      ],
      fillColor: '#f8f5fd',
    }) : ({ text: '', border: [false, false, false, false] })));
  }
  return {
    table: { widths: ['*', '*', '*'], body: rows },
    layout: {
      hLineColor: () => '#ebe4f7', vLineColor: () => '#ebe4f7',
      hLineWidth: () => 1, vLineWidth: () => 1,
      paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 12, paddingBottom: () => 12,
    },
    margin: [0, 0, 0, 14],
  };
}

function chartSection(title: string, image: string | null, empty: string, pageBreak?: 'before'): Content[] {
  return [
    {
      stack: [
        { text: title, style: 'sectionTitle', margin: [0, 4, 0, 8] },
        image ? { image, width: 500, alignment: 'center' } : { text: empty, fillColor: '#f8f5fd', color: '#5f4b82', margin: [0, 6, 0, 0] },
      ],
      unbreakable: pageBreak ? undefined : true,
      pageBreak,
      margin: [0, 0, 0, 14],
    },
  ];
}

function table(title: string, headers: string[], rows: Array<Array<string | number>>, widths: Array<string | number>): Content[] {
  return [
    { text: title, style: 'sectionTitle', margin: [0, 4, 0, 8] },
    {
      table: {
        headerRows: 1,
        widths,
        body: [headers.map((text) => ({ text, style: 'tableHeader' })), ...rows],
      },
      layout: {
        fillColor: (rowIndex: number) => rowIndex === 0 ? '#efe7fb' : rowIndex % 2 === 0 ? '#fcfbfe' : null,
        hLineColor: () => '#e7dff4', vLineColor: () => '#e7dff4',
        paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 7, paddingBottom: () => 7,
      },
      margin: [0, 0, 0, 14],
    },
  ];
}

function definition(title: string, subtitle: string, logo: string | null, range: string, content: Content[]): TDocumentDefinitions {
  const generated = new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date());
  return {
    pageSize: 'A4',
    pageMargins: [40, 70, 40, 45],
    header: (page: number) => page === 1 ? null : ({
      margin: [40, 20, 40, 0],
      columns: [
        { text: title, color: '#5d3f8b', bold: true, fontSize: 10 },
        { text: range, alignment: 'right', color: '#7f7196', fontSize: 9 },
      ],
    }),
    footer: (page: number, pages: number) => ({
      margin: [40, 0, 40, 18],
      columns: [
        { text: `Generado: ${generated}`, color: '#87799d', fontSize: 8 },
        { text: `Página ${page} de ${pages}`, alignment: 'right', color: '#87799d', fontSize: 8 },
      ],
    }),
    content: [
      {
        stack: [
          logo ? { image: logo, width: 190, margin: [0, 0, 0, 26] } : { text: 'GRUPO MOVENSA', color: '#df6b22', bold: true, fontSize: 18, margin: [0, 0, 0, 26] },
          { text: title, style: 'coverTitle' },
          { text: subtitle, style: 'coverSubtitle' },
          {
            columns: [
              { width: '*', stack: [{ text: 'Rango seleccionado', style: 'coverLabel' }, { text: range, style: 'coverValue' }] },
              { width: '*', stack: [{ text: 'Fecha de generación', style: 'coverLabel' }, { text: generated, style: 'coverValue' }] },
            ],
            columnGap: 24,
            margin: [0, 24, 0, 0],
          },
        ],
        margin: [0, 80, 0, 0],
      },
      { text: '', pageBreak: 'after' },
      ...content,
    ],
    styles: {
      coverTitle: { fontSize: 24, bold: true, color: '#2f1848' },
      coverSubtitle: { fontSize: 12, color: '#6c5a8a', margin: [0, 8, 0, 0] },
      coverLabel: { fontSize: 9, color: '#7f7196', bold: true, margin: [0, 0, 0, 4] },
      coverValue: { fontSize: 13, color: '#2f1848' },
      sectionTitle: { fontSize: 14, bold: true, color: '#412666' },
      sectionLead: { fontSize: 10, color: '#5f4b82', margin: [0, 0, 0, 12] },
      tableHeader: { bold: true, color: '#412666', fontSize: 9 },
    },
    defaultStyle: { font: 'Poppins', fontSize: 9, color: '#33214f' },
  };
}

export async function exportGeneralReportPdf(report: GeneralPdfReport, from: string, to: string): Promise<void> {
  const logo = await dataUrl('/brand/grupo-movensa.png');
  const labels = report.series.map((item) => new Intl.DateTimeFormat('es-CR', { day: '2-digit', month: 'short' }).format(new Date(`${item.day}T12:00:00`)));
  const line = await chartImage({
    type: 'line',
    data: { labels, datasets: [{ label: 'Mensajes', data: report.series.map((item) => item.messages), tension: .3, fill: true, borderColor: '#df6b22', backgroundColor: 'rgba(223,107,34,.16)' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  const countries = await chartImage({
    type: 'doughnut',
    data: { labels: report.countries.map((item) => item.country), datasets: [{ data: report.countries.map((item) => item.count), backgroundColor: ['#df6b22', '#f08a46', '#f5a66f', '#b84d0c', '#7d350d'] }] },
    options: { cutout: '55%', plugins: { legend: { position: 'bottom' } } },
  });
  const channels = await chartImage({
    type: 'doughnut',
    data: { labels: report.channels?.map((item) => item.channel === 'whatsapp' ? 'WhatsApp' : 'Webchat') ?? ['Sin datos'], datasets: [{ data: report.channels?.map((item) => item.count) ?? [1], backgroundColor: ['#df6b22', '#f08a46', '#f5a66f'] }] },
    options: { cutout: '55%', plugins: { legend: { position: 'bottom' } } },
  });
  const topClients = await chartImage({
    type: 'bar',
    data: { labels: report.topClients.map((item) => item.name), datasets: [{ label: 'Mensajes', data: report.topClients.map((item) => item.messages), backgroundColor: '#f08a46' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  }, 960, 380);
  const team = await chartImage({
    type: 'bar',
    data: { labels: report.team.map((item) => item.name), datasets: [{ label: 'Atendidas', data: report.team.map((item) => item.handled_conversations), backgroundColor: '#f08a46' }, { label: 'Cerradas', data: report.team.map((item) => item.closed_conversations), backgroundColor: '#b84d0c' }] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  }, 960, 380);
  const overview = report.overview;
  const range = `${from} a ${to}`;
  const content: Content[] = [
    { text: 'Resumen ejecutivo', style: 'sectionTitle' },
    { text: `En el período analizado se registraron ${number(overview.total_messages)} mensajes, ${number(overview.closed)} conversaciones cerradas y ${number(overview.new_clients)} clientes nuevos. La primera respuesta promedio fue de ${metric(minutesFromSeconds(overview.average_first_response_seconds), ' min')}, la resolución promedio de ${metric(overview.average_resolution_minutes, ' min')} y el SLA menor a 5 minutos alcanzó ${metric(overview.sla_under_five_rate, '%')}.`, style: 'sectionLead' },
    metricCards([
      { label: 'Total de mensajes', value: metric(overview.total_messages), hint: 'Volumen total del período' },
      { label: 'Conversaciones cerradas', value: metric(overview.closed), hint: 'Cierres registrados' },
      { label: 'Clientes nuevos', value: metric(overview.new_clients), hint: 'Altas reales en el rango' },
      { label: 'Conversaciones abiertas', value: metric(overview.open_conversations), hint: 'Sesiones activas' },
      { label: 'Clientes activos', value: metric(overview.active_clients), hint: 'Con actividad real' },
      { label: 'Países activos', value: metric(overview.active_countries), hint: 'Cobertura geográfica' },
      { label: 'Mensajes por conversación', value: metric(overview.messages_per_conversation), hint: 'Promedio del período' },
      { label: 'Primera respuesta promedio', value: metric(minutesFromSeconds(overview.average_first_response_seconds), ' min'), hint: 'Velocidad de atención' },
      { label: 'Resolución promedio', value: metric(overview.average_resolution_minutes, ' min'), hint: 'Tiempo hasta cierre' },
      { label: 'SLA menor a 5 minutos', value: metric(overview.sla_under_five_rate, '%'), hint: 'Cumplimiento' },
      { label: 'Escaladas a agente', value: metric(overview.escalated_conversations), hint: 'Casos con humano' },
    ]),
    ...chartSection('Mensajes por fecha', line, 'Sin datos disponibles para los filtros seleccionados.'),
    ...chartSection('Países de los contactos', countries, 'No hay información suficiente para mostrar este gráfico.'),
    ...chartSection('Canales activos', channels, 'No hay información suficiente para mostrar este gráfico.'),
    ...chartSection('Top clientes por mensajes', topClients, 'Sin datos disponibles para los filtros seleccionados.'),
    ...chartSection('Rendimiento del equipo', team, 'Sin datos de agentes en el rango seleccionado.', 'before'),
    ...table('Top clientes', ['Cliente', 'Teléfono', 'Mensajes'], report.topClients.map((item) => [item.name, item.phone_number, item.messages]), ['*', 120, 70]),
    ...table('Rendimiento del equipo', ['Agente', 'Atendidas', 'Cerradas', 'SLA < 5 min'], report.team.map((item) => [item.name, item.handled_conversations, item.closed_conversations, item.sla_under_five_rate === null ? '—' : `${item.sla_under_five_rate}%`]), ['*', 75, 70, 75]),
  ];
  pdfMake.createPdf(definition('Reporte de Analíticas', 'Analíticas generales', logo, range, content), undefined, poppinsFonts, pdfMake.vfs).download(`reporte-analiticas-generales-${from}-${to}.pdf`);
}

export async function exportAgentReportPdf({ agent, closures, from, to }: AgentPdfData): Promise<void> {
  const logo = await dataUrl('/brand/grupo-movensa.png');
  const grouped = new Map<string, number>();
  for (const closure of closures) {
    const day = closure.ended_at.slice(0, 10);
    grouped.set(day, (grouped.get(day) ?? 0) + 1);
  }
  const closedChart = await chartImage({
    type: 'bar',
    data: { labels: [...grouped.keys()], datasets: [{ label: 'Conversaciones cerradas', data: [...grouped.values()], backgroundColor: '#df6b22' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  const range = `${from} a ${to}`;
  const content: Content[] = [
    { text: 'Resumen ejecutivo', style: 'sectionTitle' },
    { text: `${agent.name} atendió ${number(agent.handled_conversations)} conversaciones y cerró ${number(agent.closed_conversations)} durante el período. Envió ${number(agent.sent_messages)} mensajes y alcanzó un SLA menor a 5 minutos de ${metric(agent.sla_under_five_rate, '%')}.`, style: 'sectionLead' },
    metricCards([
      { label: 'Agente seleccionado', value: agent.name, hint: agent.email },
      { label: 'Conversaciones cerradas', value: metric(agent.closed_conversations), hint: 'Cerradas en el período' },
      { label: 'Última actividad', value: dateTime(agent.last_activity), hint: 'Hora Costa Rica' },
      { label: 'Estado', value: agent.is_online ? 'En línea' : 'Desconectado', hint: 'Disponibilidad actual' },
      { label: 'Duración promedio', value: metric(agent.average_resolution_minutes, ' min'), hint: 'Tiempo medio de cierre' },
      { label: 'Primera respuesta promedio', value: metric(minutesFromSeconds(agent.average_first_response_seconds), ' min'), hint: 'Velocidad de respuesta' },
      { label: 'Mensajes enviados', value: metric(agent.sent_messages), hint: 'Mensajes del agente' },
      { label: 'Conversaciones atendidas', value: metric(agent.handled_conversations), hint: 'Con respuesta humana' },
      { label: 'SLA < 5 minutos', value: metric(agent.sla_under_five_rate, '%'), hint: 'Cumplimiento del objetivo' },
    ]),
    ...chartSection('Conversaciones cerradas por agente', closedChart, 'No hay conversaciones cerradas en el período.'),
    ...table('Conversaciones cerradas', ['Teléfono', 'Inicio', 'Cierre', '1ra resp.', 'Duración'], closures.map((item) => [item.contact_phone, dateTime(item.started_at), dateTime(item.ended_at), metric(item.first_response_minutes, ' min'), metric(item.duration_minutes, ' min')]), [80, '*', '*', 60, 60]),
  ];
  pdfMake.createPdf(definition('Reporte de Analíticas', 'Analíticas por agente', logo, range, content), undefined, poppinsFonts, pdfMake.vfs).download(`reporte-analiticas-agente-${slug(agent.name)}-${from}-${to}.pdf`);
}
