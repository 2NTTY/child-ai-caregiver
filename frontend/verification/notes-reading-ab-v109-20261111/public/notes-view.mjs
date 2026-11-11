import {NOTES} from './notes-data.mjs';

export function renderNotes(document, state, onRead, notes = NOTES) {
  const node = (tag, text = '', attributes = {}) => {
    const element = document.createElement(tag);
    element.textContent = text;
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  };
  let activeHeading = null;
  const articleFor = note => {
    const heading = node('h2', note.title, {class: 'note-title', id: `note-title-${note.id}`});
    if (state.layout === 'A') {
      heading.setAttribute('tabindex', '-1');
      activeHeading = heading;
    }
    const article = node('article', '', {class: 'note-card', 'data-note-id': note.id, 'aria-labelledby': `note-title-${note.id}`});
    const metadata = node('div', '', {class: 'note-metadata'});
    metadata.append(node('span', note.originLabel, {class: 'origin-label'}),
      node('span', `版本 ${note.version} · ${note.updatedAtLabel}`, {class: 'note-date'}));
    article.append(heading, metadata, node('p', note.body, {class: 'note-body'}),
      node('p', `來源：${note.sourceText}`, {class: 'note-source'}));
    if (note.sourceNotice) article.append(node('p', note.sourceNotice, {class: 'source-notice'}));
    return article;
  };
  const element = node('div', '', {class: `notes-layout layout-${state.layout}`});
  if (state.layout === 'A') {
    const index = node('nav', '', {class: 'notes-index', 'aria-label': '合成備註索引'});
    index.append(node('p', '三則合成備註', {class: 'index-title'}));
    const list = node('ul');
    for (const note of notes) {
      const button = node('button', '', {type: 'button', class: 'note-index-button', 'data-note-id': note.id});
      if (note.id === state.activeId) button.setAttribute('aria-current', 'true');
      button.append(node('span', note.title, {class: 'index-note-title'}),
        node('span', `${note.originLabel} · ${note.sourceText}`, {class: 'index-note-source'}));
      button.addEventListener('click', () => onRead(note.id));
      const item = node('li');
      item.append(button);
      list.append(item);
    }
    index.append(list);
    element.append(index, articleFor(notes.find(note => note.id === state.activeId)));
  } else {
    for (const note of notes) element.append(articleFor(note));
  }
  return {element, activeHeading};
}
