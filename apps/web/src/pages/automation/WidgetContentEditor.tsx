import { useState, type FormEvent } from 'react';
import { CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import { Badge, Button, Card } from '../../components/ui';
import { formatApiError } from '../../lib/api';

type LooseRecord = Record<string, unknown>;
type QuickLink = { id: string; title: string; type: string; targetId: string; url: string; isActive: boolean; sortOrder: number };
type FaqQuestion = { id: string; question: string; answer: string; isActive: boolean; sortOrder: number };
type FaqCategory = { id: string; name: string; isActive: boolean; sortOrder: number; questions: FaqQuestion[] };
type Article = { id: string; title: string; content: string; isActive: boolean; sortOrder: number };
type ArticleCategory = { id: string; name: string; isActive: boolean; sortOrder: number; articles: Article[] };
type EditorContent = LooseRecord & { quickLinks: QuickLink[]; faqCategories: FaqCategory[]; articleCategories: ArticleCategory[] };

function records(value: unknown): LooseRecord[] {
  return Array.isArray(value) ? value.filter((item): item is LooseRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function boolValue(value: unknown): boolean { return value !== false; }
function idValue(value: unknown): string { return stringValue(value) || crypto.randomUUID(); }

function normalize(input: LooseRecord): EditorContent {
  const quickLinks = records(input.quickLinks).map((item, index) => ({
    id: idValue(item.id), title: stringValue(item.title), type: stringValue(item.type) === 'external' ? 'url' : stringValue(item.type) || 'conversation',
    targetId: stringValue(item.targetId), url: stringValue(item.url), isActive: boolValue(item.isActive), sortOrder: Number(item.sortOrder) || index + 1,
  }));
  const faqCategories = records(input.faqCategories).map((category, categoryIndex) => ({
    id: idValue(category.id), name: stringValue(category.name), isActive: boolValue(category.isActive), sortOrder: Number(category.sortOrder) || categoryIndex + 1,
    questions: records(category.questions).map((question, questionIndex) => ({
      id: idValue(question.id), question: stringValue(question.question), answer: stringValue(question.answer),
      isActive: boolValue(question.isActive), sortOrder: Number(question.sortOrder) || questionIndex + 1,
    })),
  }));
  const articleCategories = records(input.articleCategories).map((category, categoryIndex) => ({
    id: idValue(category.id), name: stringValue(category.name), isActive: boolValue(category.isActive), sortOrder: Number(category.sortOrder) || categoryIndex + 1,
    articles: records(category.articles).map((article, articleIndex) => ({
      id: idValue(article.id), title: stringValue(article.title), content: stringValue(article.content),
      isActive: boolValue(article.isActive), sortOrder: Number(article.sortOrder) || articleIndex + 1,
    })),
  }));
  return { ...input, quickLinks, faqCategories, articleCategories };
}

function newId(): string { return `wc_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`; }

export function WidgetContentEditor({ initial, saving, saved, error, onSave, mode = 'all' }: {
  initial: LooseRecord;
  saving: boolean;
  saved: boolean;
  error: unknown;
  onSave: (content: LooseRecord) => void;
  mode?: 'all' | 'texts' | 'quick-links' | 'faqs' | 'articles';
}) {
  const [content, setContent] = useState<EditorContent>(() => normalize(initial));
  const setText = (key: string, value: string) => setContent((current) => ({ ...current, [key]: value }));

  function addQuickLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim(); if (!title) return;
    setContent((current) => ({ ...current, quickLinks: [...current.quickLinks, { id: newId(), title, type: String(form.get('type') ?? 'conversation'), targetId: String(form.get('targetId') ?? '').trim(), url: String(form.get('url') ?? '').trim(), isActive: form.get('isActive') !== 'false', sortOrder: current.quickLinks.length + 1 }] }));
    event.currentTarget.reset();
  }

  function addFaqCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') ?? '').trim(); if (!name) return;
    setContent((current) => ({ ...current, faqCategories: [...current.faqCategories, { id: newId(), name, isActive: true, sortOrder: current.faqCategories.length + 1, questions: [] }] }));
    event.currentTarget.reset();
  }

  function addQuestion(event: FormEvent<HTMLFormElement>, categoryId: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const question = String(form.get('question') ?? '').trim(); const answer = String(form.get('answer') ?? '').trim(); if (!question || !answer) return;
    setContent((current) => ({ ...current, faqCategories: current.faqCategories.map((category) => category.id === categoryId ? { ...category, questions: [...category.questions, { id: newId(), question, answer, isActive: true, sortOrder: category.questions.length + 1 }] } : category) }));
    event.currentTarget.reset();
  }

  function addArticleCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') ?? '').trim(); if (!name) return;
    setContent((current) => ({ ...current, articleCategories: [...current.articleCategories, { id: newId(), name, isActive: true, sortOrder: current.articleCategories.length + 1, articles: [] }] }));
    event.currentTarget.reset();
  }

  function addArticle(event: FormEvent<HTMLFormElement>, categoryId: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const title = String(form.get('title') ?? '').trim(); const body = String(form.get('content') ?? '').trim(); if (!title || !body) return;
    setContent((current) => ({ ...current, articleCategories: current.articleCategories.map((category) => category.id === categoryId ? { ...category, articles: [...category.articles, { id: newId(), title, content: body, isActive: true, sortOrder: category.articles.length + 1 }] } : category) }));
    event.currentTarget.reset();
  }

  return <Card className="content-editor">
    <div className="card-heading content-editor__heading"><div><p className="eyebrow">Centro de ayuda</p><h2>{mode === 'quick-links' ? 'Accesos rápidos' : mode === 'faqs' ? 'Preguntas frecuentes' : mode === 'articles' ? 'Artículos' : mode === 'texts' ? 'Textos del widget' : 'Contenido del widget'}</h2></div><div className="button-row">{saved && <span className="success-text"><CheckCircle2 size={15} />Guardado</span>}<Button onClick={() => onSave(content)} disabled={saving}><Save size={16} />{saving ? 'Guardando…' : mode === 'quick-links' ? 'Guardar accesos rápidos' : mode === 'faqs' ? 'Guardar preguntas frecuentes' : mode === 'articles' ? 'Guardar artículos' : 'Guardar contenido'}</Button></div></div>
    {Boolean(error) && <p className="form-error">{formatApiError(error)}</p>}
    {(mode === 'all' || mode === 'texts') && <section className="content-editor__section"><div className="content-editor__title"><div><h3>Textos y comportamiento</h3></div></div><div className="form-grid"><label><span>Formato del lanzador</span><select value={stringValue(content.launcherMode) || 'card'} onChange={(event) => setText('launcherMode', event.target.value)}><option value="card">Botón con texto</option><option value="bubble">Burbuja compacta</option></select></label><label><span>Texto del lanzador</span><input value={stringValue(content.launcherSubtitle)} placeholder="¿Necesitas ayuda?" onChange={(event) => setText('launcherSubtitle', event.target.value)} /></label><label><span>Título de inicio</span><input value={stringValue(content.homePrimaryText)} placeholder="¿Cómo podemos ayudarte?" onChange={(event) => setText('homePrimaryText', event.target.value)} /></label><label><span>Botón de nueva conversación</span><input value={stringValue(content.newConversationText)} placeholder="Iniciar conversación" onChange={(event) => setText('newConversationText', event.target.value)} /></label><label><span>Conversación vacía</span><input value={stringValue(content.conversationEmptyText)} placeholder="Cuéntanos cómo podemos ayudarte." onChange={(event) => setText('conversationEmptyText', event.target.value)} /></label><label><span>Conversación cerrada</span><input value={stringValue(content.conversationClosedText)} placeholder="Esta conversación ha finalizado." onChange={(event) => setText('conversationClosedText', event.target.value)} /></label><label><span>Buscador de preguntas</span><input value={stringValue(content.faqSearchPlaceholder)} placeholder="Buscar preguntas…" onChange={(event) => setText('faqSearchPlaceholder', event.target.value)} /></label><label><span>Buscador de artículos</span><input value={stringValue(content.articleSearchPlaceholder)} placeholder="Buscar artículos…" onChange={(event) => setText('articleSearchPlaceholder', event.target.value)} /></label></div></section>}
    {(mode === 'all' || mode === 'quick-links') && <section className="content-editor__section"><div className="content-editor__title"><div><Badge tone="orange">{content.quickLinks.length}</Badge><h3>Listado de accesos</h3></div></div><form className="mini-add-form mini-add-form--wide" onSubmit={addQuickLink}><input name="title" required placeholder="Texto del acceso" /><select name="type" aria-label="Tipo de acceso"><option value="conversation">Abrir conversación</option><option value="faq">Categoría FAQ</option><option value="article">Categoría de artículos</option><option value="url">Enlace externo</option></select><input name="targetId" placeholder="Target (ID interno)" /><input name="url" type="url" placeholder="https://… (para URL)" /><select name="isActive" aria-label="Acceso activo"><option value="true">Activo</option><option value="false">Inactivo</option></select><Button type="submit" variant="secondary"><Plus size={14} />Agregar acceso</Button></form><div className="editable-list editable-list--detailed">{content.quickLinks.map((item) => <article key={item.id}><input aria-label="Título del acceso" value={item.title} onChange={(event) => setContent((current) => ({ ...current, quickLinks: current.quickLinks.map((link) => link.id === item.id ? { ...link, title: event.target.value } : link) }))} /><select aria-label="Tipo del acceso" value={item.type} onChange={(event) => setContent((current) => ({ ...current, quickLinks: current.quickLinks.map((link) => link.id === item.id ? { ...link, type: event.target.value } : link) }))}><option value="conversation">Abrir conversación</option><option value="faq">Categoría FAQ</option><option value="article">Categoría de artículos</option><option value="url">Enlace externo</option></select><input aria-label="Target del acceso" value={item.targetId} placeholder="ID de categoría" onChange={(event) => setContent((current) => ({ ...current, quickLinks: current.quickLinks.map((link) => link.id === item.id ? { ...link, targetId: event.target.value } : link) }))} /><input aria-label="URL del acceso" value={item.url} placeholder="URL" onChange={(event) => setContent((current) => ({ ...current, quickLinks: current.quickLinks.map((link) => link.id === item.id ? { ...link, url: event.target.value } : link) }))} /><select aria-label="Estado del acceso" value={item.isActive ? 'true' : 'false'} onChange={(event) => setContent((current) => ({ ...current, quickLinks: current.quickLinks.map((link) => link.id === item.id ? { ...link, isActive: event.target.value === 'true' } : link) }))}><option value="true">Activo</option><option value="false">Inactivo</option></select><Button variant="ghost" aria-label={`Eliminar ${item.title}`} onClick={() => setContent((current) => ({ ...current, quickLinks: current.quickLinks.filter((link) => link.id !== item.id) }))}><Trash2 size={14} /></Button></article>)}</div></section>}
    {(mode === 'all' || mode === 'faqs') && <section className="content-editor__section"><div className="content-editor__title"><div><Badge tone="orange">{content.faqCategories.reduce((total, category) => total + category.questions.length, 0)}</Badge><h3>Categorías y preguntas</h3></div></div><form className="mini-add-form" onSubmit={addFaqCategory}><input name="name" required placeholder="Nueva categoría" /><Button type="submit" variant="secondary"><Plus size={14} />Agregar categoría</Button></form><div className="content-category-grid">{content.faqCategories.map((category) => <article className="content-category" key={category.id}><header><input aria-label="Nombre de categoría" value={category.name} onChange={(event) => setContent((current) => ({ ...current, faqCategories: current.faqCategories.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item) }))} /><select aria-label="Estado de categoría" value={category.isActive ? 'true' : 'false'} onChange={(event) => setContent((current) => ({ ...current, faqCategories: current.faqCategories.map((item) => item.id === category.id ? { ...item, isActive: event.target.value === 'true' } : item) }))}><option value="true">Activa</option><option value="false">Inactiva</option></select><Button variant="ghost" aria-label={`Eliminar categoría ${category.name}`} onClick={() => setContent((current) => ({ ...current, faqCategories: current.faqCategories.filter((item) => item.id !== category.id) }))}><Trash2 size={14} /></Button></header>{category.questions.map((question) => <div className="nested-editor" key={question.id}><input value={question.question} aria-label="Pregunta" onChange={(event) => setContent((current) => ({ ...current, faqCategories: current.faqCategories.map((item) => item.id === category.id ? { ...item, questions: item.questions.map((row) => row.id === question.id ? { ...row, question: event.target.value } : row) } : item) }))} /><select aria-label="Estado de pregunta" value={question.isActive ? 'true' : 'false'} onChange={(event) => setContent((current) => ({ ...current, faqCategories: current.faqCategories.map((item) => item.id === category.id ? { ...item, questions: item.questions.map((row) => row.id === question.id ? { ...row, isActive: event.target.value === 'true' } : row) } : item) }))}><option value="true">Activa</option><option value="false">Inactiva</option></select><textarea value={question.answer} aria-label="Respuesta" rows={3} onChange={(event) => setContent((current) => ({ ...current, faqCategories: current.faqCategories.map((item) => item.id === category.id ? { ...item, questions: item.questions.map((row) => row.id === question.id ? { ...row, answer: event.target.value } : row) } : item) }))} /><Button variant="ghost" aria-label="Eliminar pregunta" onClick={() => setContent((current) => ({ ...current, faqCategories: current.faqCategories.map((item) => item.id === category.id ? { ...item, questions: item.questions.filter((row) => row.id !== question.id) } : item) }))}><Trash2 size={14} /></Button></div>)}<form className="nested-add-form" onSubmit={(event) => addQuestion(event, category.id)}><input name="question" required placeholder="Pregunta" /><textarea name="answer" required rows={2} placeholder="Respuesta" /><Button type="submit" variant="ghost"><Plus size={14} />Pregunta</Button></form></article>)}</div></section>}
    {(mode === 'all' || mode === 'articles') && <section className="content-editor__section"><div className="content-editor__title"><div><Badge tone="orange">{content.articleCategories.reduce((total, category) => total + category.articles.length, 0)}</Badge><h3>Categorías y artículos</h3></div></div><form className="mini-add-form" onSubmit={addArticleCategory}><input name="name" required placeholder="Nueva categoría" /><Button type="submit" variant="secondary"><Plus size={14} />Agregar categoría</Button></form><div className="content-category-grid">{content.articleCategories.map((category) => <article className="content-category" key={category.id}><header><input aria-label="Nombre de categoría" value={category.name} onChange={(event) => setContent((current) => ({ ...current, articleCategories: current.articleCategories.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item) }))} /><select aria-label="Estado de categoría" value={category.isActive ? 'true' : 'false'} onChange={(event) => setContent((current) => ({ ...current, articleCategories: current.articleCategories.map((item) => item.id === category.id ? { ...item, isActive: event.target.value === 'true' } : item) }))}><option value="true">Activa</option><option value="false">Inactiva</option></select><Button variant="ghost" aria-label={`Eliminar categoría ${category.name}`} onClick={() => setContent((current) => ({ ...current, articleCategories: current.articleCategories.filter((item) => item.id !== category.id) }))}><Trash2 size={14} /></Button></header>{category.articles.map((article) => <div className="nested-editor" key={article.id}><input value={article.title} aria-label="Título del artículo" onChange={(event) => setContent((current) => ({ ...current, articleCategories: current.articleCategories.map((item) => item.id === category.id ? { ...item, articles: item.articles.map((row) => row.id === article.id ? { ...row, title: event.target.value } : row) } : item) }))} /><select aria-label="Estado del artículo" value={article.isActive ? 'true' : 'false'} onChange={(event) => setContent((current) => ({ ...current, articleCategories: current.articleCategories.map((item) => item.id === category.id ? { ...item, articles: item.articles.map((row) => row.id === article.id ? { ...row, isActive: event.target.value === 'true' } : row) } : item) }))}><option value="true">Activo</option><option value="false">Inactivo</option></select><textarea value={article.content} aria-label="Contenido HTML" rows={8} onChange={(event) => setContent((current) => ({ ...current, articleCategories: current.articleCategories.map((item) => item.id === category.id ? { ...item, articles: item.articles.map((row) => row.id === article.id ? { ...row, content: event.target.value } : row) } : item) }))} /><div className="article-html-preview"><strong>Vista previa</strong><iframe title={`Vista previa de ${article.title}`} sandbox="" srcDoc={article.content} /></div><Button variant="ghost" aria-label="Eliminar artículo" onClick={() => setContent((current) => ({ ...current, articleCategories: current.articleCategories.map((item) => item.id === category.id ? { ...item, articles: item.articles.filter((row) => row.id !== article.id) } : item) }))}><Trash2 size={14} /></Button></div>)}<form className="nested-add-form" onSubmit={(event) => addArticle(event, category.id)}><input name="title" required placeholder="Título" /><textarea name="content" required rows={3} placeholder="Contenido HTML" /><Button type="submit" variant="ghost"><Plus size={14} />Artículo</Button></form></article>)}</div></section>}
  </Card>;
}
