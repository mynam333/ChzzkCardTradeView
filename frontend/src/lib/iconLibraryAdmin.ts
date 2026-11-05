import {
  generatedLucideIconNames,
  generatedMdiExportNames,
  generatedSuggestedIconOptions
} from './generatedIconCatalog';

const toPascalCase = (value: string) =>
  value
    .split(/[-_:\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');

const mdiExportName = (name: string) => {
  const raw = name.trim();
  if (/^mdi[A-Z]/.test(raw)) return raw;
  const normalized = raw.replace(/^mdi[:_-]?/i, '');
  return `mdi${toPascalCase(normalized)}`;
};

const isMdiName = (name: string) => /^mdi[:_-]?/i.test(name) || /^mdi[A-Z]/.test(name);

export const suggestedIconOptions = generatedSuggestedIconOptions;

export const appIconExists = (name?: string | null) => {
  const raw = String(name || '').trim();
  if (!raw) return true;
  if (isMdiName(raw)) return generatedMdiExportNames.has(mdiExportName(raw));
  if (/^lucide:/i.test(raw)) return generatedLucideIconNames.has(raw.slice(7));
  return generatedLucideIconNames.has(raw);
};
