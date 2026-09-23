import poppins400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?inline';
import poppins500 from '@fontsource/poppins/files/poppins-latin-500-normal.woff2?inline';
import poppins600 from '@fontsource/poppins/files/poppins-latin-600-normal.woff2?inline';
import poppins700 from '@fontsource/poppins/files/poppins-latin-700-normal.woff2?inline';

type WidgetConfig = {
  name?: string;
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  position?: 'bottom-left' | 'bottom-right';
  headerTitle?: string;
  welcomeText?: string;
  placeholderText?: string;
  bubbleText?: string;
  brandText?: string;
  showBranding?: boolean;
  allowFreeText?: boolean;
  allowLiveChat?: boolean;
  borderRadius?: number;
  launcherIcon?: string | null;
  conversationEmptyImage?: string | null;
  content?: Record<string, unknown>;
};

type QuickLink = { id?: string; title?: string; type?: string; targetId?: string; url?: string; isActive?: boolean };
type FaqCategory = { id?: string; name?: string; isActive?: boolean; questions?: Array<{ id?: string; question?: string; answer?: string; isActive?: boolean }> };
type ArticleCategory = { id?: string; name?: string; isActive?: boolean; articles?: Array<{ id?: string; title?: string; content?: string; isActive?: boolean }> };

type ChatMessage = {
  id: string;
  sender: 'visitor' | 'bot' | 'agent' | 'system';
  message_type: string;
  content: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

type ApiError = { error?: { message?: string } };

const styles = `
  @font-face{font-family:Poppins;src:url(${poppins400}) format("woff2");font-weight:400;font-style:normal;font-display:swap}
  @font-face{font-family:Poppins;src:url(${poppins500}) format("woff2");font-weight:500;font-style:normal;font-display:swap}
  @font-face{font-family:Poppins;src:url(${poppins600}) format("woff2");font-weight:600;font-style:normal;font-display:swap}
  @font-face{font-family:Poppins;src:url(${poppins700}) format("woff2");font-weight:700;font-style:normal;font-display:swap}
  :host{all:initial;color-scheme:light;--movensa-primary:#e87528;--movensa-accent:#fff1e8;--movensa-bg:#fff;--movensa-text:#222;--movensa-radius:18px;font-family:Poppins,ui-sans-serif,system-ui,sans-serif}
  *,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}.movensa-root{position:fixed;z-index:2147483000;bottom:20px;display:flex;flex-direction:column;align-items:flex-end;gap:12px;color:var(--movensa-text)}
  .movensa-root.right{right:20px}.movensa-root.left{left:20px;align-items:flex-start}.movensa-launcher{border:0;border-radius:999px;background:var(--movensa-primary);color:#fff;min-height:54px;padding:0 19px;display:flex;align-items:center;gap:9px;font:700 14px/1 inherit;box-shadow:0 10px 32px #231b1530;cursor:pointer}
  .movensa-launcher:hover{filter:brightness(.96)}.movensa-launcher.bubble{width:54px;padding:0;justify-content:center}.movensa-launcher.bubble>span:last-child{display:none}.movensa-launcher img{width:30px;height:30px;border-radius:50%;object-fit:cover}.movensa-launcher:focus-visible,.movensa-send:focus-visible,.movensa-close:focus-visible,.movensa-agent:focus-visible,.movensa-form input:focus-visible{outline:3px solid color-mix(in srgb,var(--movensa-primary),transparent 55%);outline-offset:2px}
  .movensa-panel{width:min(390px,calc(100vw - 28px));height:min(650px,calc(100vh - 100px));min-height:430px;background:var(--movensa-bg);border:1px solid #e9e7e4;border-radius:var(--movensa-radius);box-shadow:0 24px 70px #231b152b;overflow:hidden;display:none;flex-direction:column}.movensa-panel.open{display:flex;animation:movensa-in .18s ease-out}
  @keyframes movensa-in{from{opacity:0;transform:translateY(9px) scale(.985)}to{opacity:1;transform:none}}
  .movensa-header{background:var(--movensa-primary);color:#fff;display:flex;align-items:center;padding:17px 17px 16px;gap:11px}.movensa-mark{width:36px;height:36px;border-radius:12px;background:#ffffff24;display:grid;place-items:center;font:800 14px/1 inherit}.movensa-headcopy{min-width:0;flex:1}.movensa-headcopy strong{font:750 15px/1.25 inherit;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.movensa-headcopy small{font:500 12px/1.4 inherit;opacity:.85}.movensa-close{width:36px;height:36px;border:0;border-radius:10px;background:transparent;color:#fff;font:400 25px/1 inherit;cursor:pointer}
  .movensa-nav{display:flex;gap:3px;padding:7px;background:#fff;border-bottom:1px solid #ece9e5;overflow-x:auto}.movensa-nav button{flex:1;border:0;border-radius:8px;padding:8px 7px;background:transparent;color:#6c6863;font:650 11px/1 inherit;white-space:nowrap;cursor:pointer}.movensa-nav button.active{color:#8c451b;background:var(--movensa-accent)}
  .movensa-messages,.movensa-home,.movensa-help{flex:1;overflow:auto;background:#faf9f7}.movensa-messages{padding:18px 14px;scroll-behavior:smooth}.movensa-home,.movensa-help{padding:20px 16px}.movensa-home h2{margin:4px 0 8px;font:750 21px/1.25 inherit}.movensa-home>p{margin:0 0 18px;color:#6c6863;font:450 13px/1.55 inherit}.movensa-home-primary{width:100%;border:0;border-radius:12px;padding:12px;background:var(--movensa-primary);color:#fff;font:700 13px/1 inherit;cursor:pointer}.movensa-quick{display:grid;gap:8px;margin-top:17px}.movensa-quick button,.movensa-help details{border:1px solid #e6e2dc;border-radius:11px;background:#fff}.movensa-quick button{display:flex;justify-content:space-between;padding:11px 12px;color:var(--movensa-text);font:620 12px/1.35 inherit;text-align:left;cursor:pointer}.movensa-help h2{margin:0 0 14px;font:750 18px/1.25 inherit}.movensa-search{width:100%;margin:0 0 12px;border:1px solid #dcd8d2;border-radius:10px;padding:10px 11px;color:var(--movensa-text);background:#fff;font:500 12px/1.2 inherit}.movensa-search:focus{outline:0;border-color:var(--movensa-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--movensa-primary),transparent 84%)}.movensa-help h3{margin:17px 0 8px;color:#6c6863;font:700 11px/1.2 inherit;text-transform:uppercase;letter-spacing:.06em}.movensa-help details{margin:7px 0;padding:0 11px}.movensa-help summary{padding:11px 0;font:650 12px/1.35 inherit;cursor:pointer}.movensa-help details p{margin:0;padding:0 0 12px;color:#5f5a54;font:450 12px/1.55 inherit;white-space:pre-wrap}.movensa-help-empty{margin:18px 0;color:#6c6863;text-align:center;font:500 12px/1.45 inherit}.movensa-welcome{text-align:center;padding:12px 18px 20px;color:#6c6863;font:500 13px/1.55 inherit}.movensa-welcome img{display:block;max-width:150px;max-height:120px;margin:0 auto 12px;object-fit:contain}.movensa-message{display:flex;margin:8px 0}.movensa-message.visitor{justify-content:flex-end}.movensa-bubble{max-width:83%;padding:10px 12px;border-radius:14px 14px 14px 4px;background:#fff;border:1px solid #e9e7e4;box-shadow:0 2px 7px #231b1508;font:450 14px/1.48 inherit;white-space:pre-wrap;overflow-wrap:anywhere}.movensa-message.visitor .movensa-bubble{background:var(--movensa-primary);border-color:var(--movensa-primary);color:#fff;border-radius:14px 14px 4px 14px}.movensa-bubble a{color:inherit;font-weight:650}.movensa-bubble img{display:block;max-width:100%;border-radius:9px;margin-top:7px}.movensa-bubble audio{display:block;width:min(260px,100%);height:36px;margin-top:7px}.movensa-time{display:block;margin-top:5px;font:500 10px/1 inherit;opacity:.58;text-align:right}
  .movensa-status{padding:8px 14px;background:var(--movensa-accent);color:#7c4a28;font:600 12px/1.35 inherit;text-align:center}.movensa-actions{display:flex;padding:9px 12px 0;background:#fff}.movensa-agent{border:1px solid #e2dfda;border-radius:999px;background:#fff;color:#4d4944;padding:7px 11px;font:650 12px/1 inherit;cursor:pointer}.movensa-contact{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:8px;border:1px solid #e6e2dc;border-radius:12px;background:#faf9f7}.movensa-contact input{min-width:0;border:1px solid #dcd8d2;border-radius:8px;padding:8px;font:500 11px/1.2 inherit}.movensa-contact input:first-child{grid-column:1/-1}.movensa-contact button{border:0;border-radius:8px;padding:8px;background:var(--movensa-primary);color:#fff;font:700 11px/1 inherit}.movensa-form{display:flex;align-items:flex-end;gap:8px;padding:11px 12px 12px;background:#fff}.movensa-form textarea{resize:none;max-height:95px;min-height:42px;flex:1;border:1px solid #dcd8d2;border-radius:13px;padding:10px 12px;color:var(--movensa-text);background:#fff;font:450 14px/1.4 inherit}.movensa-form textarea:focus{outline:0;border-color:var(--movensa-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--movensa-primary),transparent 84%)}.movensa-send,.movensa-attach{width:42px;height:42px;flex:none;border:0;border-radius:13px;cursor:pointer}.movensa-send{background:var(--movensa-primary);color:#fff;font:700 18px/1 inherit}.movensa-attach{display:grid;place-items:center;background:#f3f1ee;color:#5f5a54;font:700 17px/1 inherit}.movensa-send:disabled,.movensa-attach:disabled,.movensa-agent:disabled{opacity:.5;cursor:not-allowed}.movensa-brand{padding:0 12px 9px;text-align:center;background:#fff;color:#918c85;font:500 10px/1 inherit}
  @media(max-width:520px){.movensa-root{right:14px!important;left:14px!important;bottom:14px;align-items:stretch!important}.movensa-panel{width:100%;height:calc(100dvh - 88px);max-height:none}.movensa-launcher{align-self:flex-end}.movensa-root.left .movensa-launcher{align-self:flex-start}}
  @media(prefers-reduced-motion:reduce){.movensa-panel.open{animation:none}.movensa-messages{scroll-behavior:auto}}
`;

function safeColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function objectList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item) => Boolean(item) && typeof item === 'object') as T[] : [];
}

function create<K extends keyof HTMLElementTagNameMap>(name: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(name);
  if (className) element.className = className;
  return element;
}

class Webchat {
  private readonly activationKey: string;
  private readonly apiUrl: string;
  private readonly shadow: ShadowRoot;
  private config: WidgetConfig = {};
  private panel?: HTMLElement;
  private messageList?: HTMLElement;
  private homePanel?: HTMLElement;
  private helpPanel?: HTMLElement;
  private actions?: HTMLElement;
  private sectionPanels = new Map<string, HTMLElement>();
  private navButtons = new Map<string, HTMLButtonElement>();
  private form?: HTMLFormElement;
  private agentButton?: HTMLButtonElement;
  private contactForm?: HTMLFormElement;
  private textarea?: HTMLTextAreaElement;
  private status?: HTMLElement;
  private sessionKey = '';
  private latestMessageId = '0';
  private messages = new Map<string, ChatMessage>();
  private pollTimer?: number;
  private busy = false;
  private activeSection: 'home' | 'chat' | 'faqs' | 'articles' = 'home';
  private visitor: { name: string; email: string; phone: string } = { name: '', email: '', phone: '' };

  constructor(activationKey: string, apiUrl: string) {
    this.activationKey = activationKey;
    this.apiUrl = apiUrl.replace(/\/$/, '');
    try { this.visitor = { ...this.visitor, ...JSON.parse(localStorage.getItem(`movensa-webchat-visitor:${activationKey}`) ?? '{}') }; } catch { /* almacenamiento no disponible */ }
    const host = create('div');
    host.id = 'movensa-webchat';
    document.body.append(host);
    this.shadow = host.attachShadow({ mode: 'open' });
    const sheet = create('style');
    sheet.textContent = styles;
    this.shadow.append(sheet);
  }

  async initialize(): Promise<void> {
    try {
      const response = await this.request<{ widget: WidgetConfig }>('/public/webchat/bootstrap', {
        method: 'POST', body: JSON.stringify({ activationKey: this.activationKey, origin: window.location.origin }),
      });
      this.config = response.widget;
      this.renderShell();
    } catch (error) {
      console.error('[Movensa Webchat] No se pudo iniciar:', error);
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (!(init?.body instanceof FormData)) headers.set('content-type', 'application/json');
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as ApiError;
      throw new Error(body.error?.message ?? `Solicitud rechazada (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  private renderShell(): void {
    const root = create('div', `movensa-root ${this.config.position === 'bottom-left' ? 'left' : 'right'}`);
    root.style.setProperty('--movensa-primary', safeColor(this.config.primaryColor, '#e87528'));
    root.style.setProperty('--movensa-accent', safeColor(this.config.accentColor, '#fff1e8'));
    root.style.setProperty('--movensa-bg', safeColor(this.config.backgroundColor, '#ffffff'));
    root.style.setProperty('--movensa-text', safeColor(this.config.textColor, '#222222'));
    root.style.setProperty('--movensa-radius', `${Math.min(28, Math.max(8, Number(this.config.borderRadius) || 18))}px`);
    root.style.fontFamily = 'Poppins, ui-sans-serif, system-ui, sans-serif';

    const panel = create('section', 'movensa-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', text(this.config.headerTitle, 'Asistente virtual'));
    panel.setAttribute('aria-hidden', 'true');
    this.panel = panel;

    const header = create('header', 'movensa-header');
    const mark = create('span', 'movensa-mark'); mark.textContent = 'GM';
    const heading = create('div', 'movensa-headcopy');
    const title = create('strong'); title.textContent = text(this.config.headerTitle, '¿Cómo podemos ayudarte?');
    const online = create('small'); online.textContent = 'En línea';
    heading.append(title, online);
    const close = create('button', 'movensa-close'); close.type = 'button'; close.setAttribute('aria-label', 'Cerrar chat'); close.textContent = '×';
    close.addEventListener('click', () => this.toggle(false));
    header.append(mark, heading, close);

    const content = this.config.content ?? {};
    const sectionSettings = content.sections && typeof content.sections === 'object' ? content.sections as Record<string, unknown> : {};
    const quickLinks = objectList<QuickLink>(content.quickLinks).filter((item) => item.isActive !== false);
    const faqCategories = objectList<FaqCategory>(content.faqCategories).filter((item) => item.isActive !== false);
    const articleCategories = objectList<ArticleCategory>(content.articleCategories).filter((item) => item.isActive !== false);
    const nav = create('nav', 'movensa-nav'); nav.setAttribute('aria-label', 'Secciones de ayuda');
    const addNavigation = (section: 'home' | 'chat' | 'faqs' | 'articles', label: string) => {
      const button = create('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => this.showSection(section));
      this.navButtons.set(section, button); nav.append(button);
    };
    if (sectionSettings.home !== false) addNavigation('home', 'Inicio');
    if (sectionSettings.conversation !== false) addNavigation('chat', 'Chat');
    if (sectionSettings.faqs !== false && faqCategories.length) addNavigation('faqs', 'Preguntas');
    if (sectionSettings.articles !== false && articleCategories.length) addNavigation('articles', 'Artículos');

    const home = create('div', 'movensa-home'); this.homePanel = home; this.sectionPanels.set('home', home);
    const homeTitle = create('h2'); homeTitle.textContent = text(content.homePrimaryText, text(this.config.headerTitle, '¿Cómo podemos ayudarte?'));
    const homeIntro = create('p'); homeIntro.textContent = text(this.config.welcomeText, 'Hola, estamos para ayudarte.');
    const begin = create('button', 'movensa-home-primary'); begin.type = 'button'; begin.textContent = text(content.newConversationText, 'Iniciar conversación'); begin.addEventListener('click', () => this.showSection('chat'));
    home.append(homeTitle, homeIntro, begin);
    if (quickLinks.length) {
      const quick = create('div', 'movensa-quick');
      for (const link of quickLinks) {
        const button = create('button'); button.type = 'button';
        const label = create('span'); label.textContent = text(link.title, 'Abrir');
        const arrow = create('span'); arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true');
        button.append(label, arrow);
        button.addEventListener('click', () => {
          if (link.type === 'external' && link.url) window.open(link.url, '_blank', 'noopener,noreferrer');
          else if (link.type === 'faq') this.showSection('faqs');
          else if (link.type === 'article') this.showSection('articles');
          else this.showSection('chat');
        });
        quick.append(button);
      }
      home.append(quick);
    }

    const messages = create('div', 'movensa-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-live', 'polite');
    this.messageList = messages; this.sectionPanels.set('chat', messages);
    const faqs = this.renderHelp('Preguntas frecuentes', faqCategories, 'questions', text(content.faqSearchPlaceholder, 'Buscar preguntas…')); this.sectionPanels.set('faqs', faqs);
    const articles = this.renderHelp('Artículos', articleCategories, 'articles', text(content.articleSearchPlaceholder, 'Buscar artículos…')); this.sectionPanels.set('articles', articles);
    this.helpPanel = faqs;
    const status = create('div', 'movensa-status'); status.hidden = true; this.status = status;
    const actions = create('div', 'movensa-actions'); this.actions = actions;
    if (this.config.allowLiveChat !== false) {
      const agent = create('button', 'movensa-agent'); agent.type = 'button'; agent.textContent = 'Hablar con una persona';
      const contact = create('form', 'movensa-contact'); contact.hidden = true;
      this.agentButton = agent; this.contactForm = contact;
      const name = create('input'); name.name = 'name'; name.required = true; name.maxLength = 160; name.placeholder = 'Nombre'; name.value = this.visitor.name;
      const email = create('input'); email.name = 'email'; email.type = 'email'; email.placeholder = 'Correo (opcional)'; email.value = this.visitor.email;
      const phone = create('input'); phone.name = 'phone'; phone.type = 'tel'; phone.placeholder = 'Teléfono (opcional)'; phone.value = this.visitor.phone;
      const submit = create('button'); submit.type = 'submit'; submit.textContent = 'Solicitar agente';
      contact.append(name, email, phone, submit);
      agent.addEventListener('click', () => { agent.hidden = true; contact.hidden = false; name.focus(); });
      contact.addEventListener('submit', (event) => { event.preventDefault(); this.visitor = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() }; try { localStorage.setItem(`movensa-webchat-visitor:${this.activationKey}`, JSON.stringify(this.visitor)); } catch { /* almacenamiento no disponible */ } void this.requestAgent(submit); });
      actions.append(agent, contact);
    }
    const form = create('form', 'movensa-form'); this.form = form;
    const fileInput = create('input'); fileInput.type = 'file'; fileInput.hidden = true; fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,audio/mpeg,audio/ogg,audio/webm,audio/mp4,audio/wav';
    const attach = create('button', 'movensa-attach'); attach.type = 'button'; attach.setAttribute('aria-label', 'Adjuntar archivo'); attach.textContent = '＋'; attach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void this.uploadAttachment(file, attach); fileInput.value = ''; });
    const textarea = create('textarea'); this.textarea = textarea; textarea.rows = 1; textarea.maxLength = 4096; textarea.placeholder = text(this.config.placeholderText, 'Escribe tu mensaje…'); textarea.setAttribute('aria-label', textarea.placeholder);
    textarea.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
    const send = create('button', 'movensa-send'); send.type = 'submit'; send.setAttribute('aria-label', 'Enviar mensaje'); send.textContent = '➜';
    form.append(fileInput, attach, textarea, send);
    form.addEventListener('submit', (event) => { event.preventDefault(); void this.sendMessage(); });
    if (this.config.allowFreeText === false) form.hidden = true;

    panel.append(header, nav, home, messages, faqs, articles, status, actions, form);
    if (this.config.showBranding !== false) {
      const brand = create('div', 'movensa-brand'); brand.textContent = text(this.config.brandText, 'Grupo Movensa'); panel.append(brand);
    }
    const launcherMode = content.launcherMode === 'bubble' ? 'bubble' : 'card';
    const launcher = create('button', `movensa-launcher ${launcherMode}`); launcher.type = 'button'; launcher.setAttribute('aria-expanded', 'false');
    if (this.config.launcherIcon) { const icon = create('img'); icon.src = this.config.launcherIcon; icon.alt = ''; launcher.append(icon); }
    else { const icon = create('span'); icon.setAttribute('aria-hidden', 'true'); icon.textContent = '✦'; launcher.append(icon); }
    const launchText = create('span'); launchText.textContent = text(content.launcherSubtitle, text(this.config.bubbleText, '¿Necesitas ayuda?')); launcher.append(launchText);
    launcher.addEventListener('click', () => { const open = !panel.classList.contains('open'); this.toggle(open); launcher.setAttribute('aria-expanded', String(open)); });
    root.append(panel, launcher); this.shadow.append(root);
    const initial = this.navButtons.has('home') ? 'home' : 'chat';
    this.showSection(initial);
  }

  private renderHelp(titleText: string, categories: Array<FaqCategory | ArticleCategory>, kind: 'questions' | 'articles', placeholder: string): HTMLElement {
    const panel = create('div', 'movensa-help'); panel.hidden = true;
    const title = create('h2'); title.textContent = titleText; panel.append(title);
    const search = create('input', 'movensa-search'); search.type = 'search'; search.placeholder = placeholder; search.setAttribute('aria-label', placeholder); panel.append(search);
    const groups: Array<{ heading: HTMLHeadingElement; rows: Array<{ detail: HTMLDetailsElement; haystack: string }> }> = [];
    for (const category of categories) {
      const rows = kind === 'questions'
        ? objectList<Record<string, unknown>>((category as FaqCategory).questions).filter((item) => item.isActive !== false)
        : objectList<Record<string, unknown>>((category as ArticleCategory).articles).filter((item) => item.isActive !== false);
      if (!rows.length) continue;
      const heading = create('h3'); heading.textContent = text(category.name, 'General'); panel.append(heading);
      const group = { heading, rows: [] as Array<{ detail: HTMLDetailsElement; haystack: string }> };
      for (const row of rows) {
        const detail = create('details');
        const summary = create('summary'); summary.textContent = kind === 'questions' ? text(row.question, 'Pregunta') : text(row.title, 'Artículo');
        const body = create('p'); body.textContent = kind === 'questions' ? text(row.answer, '') : text(row.content, '');
        detail.append(summary, body); panel.append(detail);
        group.rows.push({ detail, haystack: `${heading.textContent} ${summary.textContent} ${body.textContent}`.toLocaleLowerCase() });
      }
      groups.push(group);
    }
    const empty = create('p', 'movensa-help-empty'); empty.textContent = groups.length ? 'No se encontraron resultados.' : 'Todavía no hay contenido disponible.'; empty.hidden = Boolean(groups.length); panel.append(empty);
    search.hidden = !groups.length;
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase(); let visible = 0;
      for (const group of groups) {
        let groupVisible = 0;
        for (const row of group.rows) { const matches = !query || row.haystack.includes(query); row.detail.hidden = !matches; if (matches) groupVisible += 1; }
        group.heading.hidden = groupVisible === 0; visible += groupVisible;
      }
      empty.hidden = visible > 0;
    });
    return panel;
  }

  private showSection(requested: 'home' | 'chat' | 'faqs' | 'articles'): void {
    const section = this.sectionPanels.has(requested) && this.navButtons.has(requested) ? requested : 'chat';
    this.activeSection = section;
    for (const [key, panel] of this.sectionPanels) panel.hidden = key !== section;
    for (const [key, button] of this.navButtons) {
      const active = key === section; button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false');
    }
    if (this.actions) this.actions.hidden = section !== 'chat';
    if (this.form) this.form.hidden = section !== 'chat' || this.config.allowFreeText === false;
    if (this.status && section !== 'chat') this.status.hidden = true;
    if (section === 'chat') {
      void this.ensureSession();
      if (this.status?.textContent) this.status.hidden = false;
      window.setTimeout(() => this.textarea?.focus(), 60);
    }
  }

  private toggle(open: boolean): void {
    if (!this.panel) return;
    this.panel.classList.toggle('open', open);
    this.panel.setAttribute('aria-hidden', String(!open));
    if (open && this.activeSection === 'chat') {
      void this.ensureSession();
      window.setTimeout(() => this.textarea?.focus(), 60);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionKey || this.busy) return;
    this.busy = true; this.setStatus('Iniciando conversación…');
    try {
      const result = await this.request<{ sessionKey: string; messages: ChatMessage[] }>('/public/webchat/sessions', {
        method: 'POST',
        body: JSON.stringify({ activationKey: this.activationKey, origin: window.location.origin, pageUrl: window.location.href, ...(document.referrer ? { referrerUrl: document.referrer } : {}), visitor: this.visitor }),
      });
      this.sessionKey = result.sessionKey;
      this.addMessages(result.messages);
      this.setStatus('');
      this.schedulePoll(500);
    } catch (error) { this.setStatus(error instanceof Error ? error.message : 'No se pudo abrir la conversación.'); }
    finally { this.busy = false; }
  }

  private async sendMessage(): Promise<void> {
    const value = this.textarea?.value.trim();
    if (!value || this.busy) return;
    if (!this.sessionKey) await this.ensureSession();
    if (!this.sessionKey) return;
    this.busy = true;
    if (this.textarea) this.textarea.disabled = true;
    try {
      const result = await this.request<{ messages: ChatMessage[] }>('/public/webchat/messages', {
        method: 'POST', body: JSON.stringify({ sessionKey: this.sessionKey, text: value, clientMessageId: crypto.randomUUID() }),
      });
      if (this.textarea) this.textarea.value = '';
      this.addMessages(result.messages);
      await this.poll();
    } catch (error) { this.setStatus(error instanceof Error ? error.message : 'No se pudo enviar el mensaje.'); }
    finally { this.busy = false; if (this.textarea) { this.textarea.disabled = false; this.textarea.focus(); } }
  }

  private async uploadAttachment(file: File, button: HTMLButtonElement): Promise<void> {
    if (file.size > 20 * 1024 * 1024) { this.setStatus('El archivo supera el límite de 20 MB.'); return; }
    if (!this.sessionKey) await this.ensureSession();
    if (!this.sessionKey || this.busy) return;
    this.busy = true; button.disabled = true; this.setStatus('Subiendo archivo…');
    try {
      const body = new FormData(); body.set('file', file, file.name);
      const message = await this.request<ChatMessage>(`/public/webchat/sessions/${encodeURIComponent(this.sessionKey)}/attachments`, { method: 'POST', body });
      this.addMessages([message]); this.setStatus('');
    } catch (error) { this.setStatus(error instanceof Error ? error.message : 'No se pudo subir el archivo.'); }
    finally { this.busy = false; button.disabled = false; }
  }

  private async requestAgent(button: HTMLButtonElement): Promise<void> {
    if (!this.sessionKey) await this.ensureSession();
    if (!this.sessionKey) return;
    button.disabled = true;
    try {
      await this.request(`/public/webchat/sessions/${encodeURIComponent(this.sessionKey)}/request-agent`, { method: 'POST', body: JSON.stringify({ visitor: this.visitor }) });
      this.setStatus('Solicitud enviada. Un agente continuará por este chat.');
    } catch (error) { this.setStatus(error instanceof Error ? error.message : 'No se pudo solicitar un agente.'); button.disabled = false; }
  }

  private addMessages(items: ChatMessage[]): void {
    for (const item of items) this.messages.set(item.id, item);
    const last = items.at(-1); if (last) this.latestMessageId = last.id;
    this.renderMessages();
  }

  private renderMessages(): void {
    if (!this.messageList) return;
    this.messageList.replaceChildren();
    if (!this.messages.size) {
      const welcome = create('div', 'movensa-welcome');
      if (this.config.conversationEmptyImage) { const image = create('img'); image.src = this.config.conversationEmptyImage; image.alt = ''; welcome.append(image); }
      const copy = create('span'); copy.textContent = text(this.config.content?.conversationEmptyText, text(this.config.welcomeText, 'Hola, cuéntanos cómo podemos ayudarte.')); welcome.append(copy); this.messageList.append(welcome);
    }
    for (const item of this.messages.values()) {
      const row = create('div', `movensa-message ${item.sender === 'visitor' ? 'visitor' : 'bot'}`);
      const bubble = create('div', 'movensa-bubble');
      const body = create('span'); body.textContent = item.content ?? (item.message_type === 'location' ? 'Ubicación compartida' : 'Archivo adjunto'); bubble.append(body);
      const payload = item.payload;
      const attachmentId = payload && (typeof payload.attachmentId === 'string' || typeof payload.attachmentId === 'number') ? String(payload.attachmentId) : '';
      const mediaUrl = payload && typeof payload.url === 'string' ? payload.url : attachmentId && this.sessionKey ? `${this.apiUrl}/public/webchat/sessions/${encodeURIComponent(this.sessionKey)}/attachments/${encodeURIComponent(attachmentId)}` : '';
      if (mediaUrl && item.message_type === 'image') { const image = create('img'); image.src = mediaUrl; image.alt = item.content ?? 'Imagen'; image.loading = 'lazy'; bubble.append(image); }
      else if (mediaUrl && item.message_type === 'audio') { const audio = create('audio'); audio.src = mediaUrl; audio.controls = true; audio.preload = 'metadata'; audio.setAttribute('controlsList', 'nodownload noplaybackrate'); audio.setAttribute('disablePictureInPicture', ''); bubble.append(audio); }
      else if (mediaUrl) { const link = create('a'); link.href = mediaUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Abrir archivo'; bubble.append(document.createElement('br'), link); }
      const time = create('time', 'movensa-time'); time.dateTime = item.created_at; time.textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(item.created_at)); bubble.append(time);
      row.append(bubble); this.messageList.append(row);
    }
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  private schedulePoll(delay = 3000): void {
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (!this.sessionKey) return;
    try {
      const result = await this.request<{ status: string; messages: ChatMessage[] }>(`/public/webchat/sessions/${encodeURIComponent(this.sessionKey)}/messages?after=${encodeURIComponent(this.latestMessageId)}`);
      this.addMessages(result.messages);
      if (result.status === 'closed') { this.showClosedConversation(); return; }
    } catch { /* El siguiente sondeo recuperará una interrupción temporal. */ }
    this.schedulePoll();
  }

  private setStatus(message: string): void {
    if (!this.status) return;
    this.status.textContent = message; this.status.hidden = !message;
  }

  private showClosedConversation(): void {
    this.setStatus(text(this.config.content?.conversationClosedText, 'Esta conversación ha finalizado.'));
    if (this.form) this.form.hidden = true;
    if (!this.actions) return;
    const restart = create('button', 'movensa-home-primary'); restart.type = 'button'; restart.textContent = text(this.config.content?.newConversationText, 'Nueva conversación');
    restart.addEventListener('click', () => { this.resetConversation(); });
    this.actions.replaceChildren(restart); this.actions.hidden = this.activeSection !== 'chat';
  }

  private resetConversation(): void {
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    this.sessionKey = ''; this.latestMessageId = '0'; this.messages.clear(); this.renderMessages(); this.setStatus('');
    if (this.actions) {
      this.actions.replaceChildren();
      if (this.agentButton && this.contactForm) { this.agentButton.hidden = false; this.contactForm.hidden = true; this.actions.append(this.agentButton, this.contactForm); }
    }
    if (this.form) this.form.hidden = this.config.allowFreeText === false || this.activeSection !== 'chat';
    void this.ensureSession();
  }
}

const loaderScript = document.currentScript as HTMLScriptElement | null;

function boot(): void {
  if (document.getElementById('movensa-webchat')) return;
  const activationKey = loaderScript?.dataset.key?.trim() ?? '';
  const apiUrl = loaderScript?.dataset.apiUrl?.trim() ?? '';
  if (!activationKey || !apiUrl) {
    console.error('[Movensa Webchat] El script requiere data-key y data-api-url.');
    return;
  }
  try {
    const parsed = new URL(apiUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    console.error('[Movensa Webchat] data-api-url debe ser una URL HTTP(S) válida.');
    return;
  }
  void new Webchat(activationKey, apiUrl).initialize();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
