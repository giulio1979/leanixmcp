/**
 * Metamodel Utilities
 *
 * Compresses LeanIX metamodel by removing redundant data:
 * - Hidden sections/fields
 * - REVERSE direction relations (duplicates of FORWARD)
 * - Non-English translations
 * - Default-false boolean flags
 * - Empty metadata
 */

interface CompressOptions {
  includeHidden?: boolean;
  includeReverseRelations?: boolean;
  includeEmptyMetadata?: boolean;
  includeAllTranslations?: boolean;
  preferredLocale?: string;
  includeDefaultBooleans?: boolean;
}

export function compressMetamodel(
  metamodel: Record<string, unknown>,
  options?: CompressOptions
): Record<string, unknown> {
  const {
    includeHidden = false,
    includeReverseRelations = false,
    includeEmptyMetadata = false,
    includeAllTranslations = false,
    preferredLocale = 'en',
    includeDefaultBooleans = false,
  } = options || {};

  // Handle both direct and wrapped responses
  let factSheetTypes: unknown[] | undefined;
  if (Array.isArray((metamodel as any).factSheetTypes)) {
    factSheetTypes = (metamodel as any).factSheetTypes;
  } else if ((metamodel as any).data?.factSheetTypes) {
    factSheetTypes = (metamodel as any).data.factSheetTypes;
  }

  if (!factSheetTypes) {
    return metamodel;
  }

  const compressed: Record<string, unknown> = {
    factSheetTypes: factSheetTypes
      .map((fst: any) =>
        compressFactSheetType(fst, {
          includeHidden,
          includeReverseRelations,
          includeEmptyMetadata,
          includeAllTranslations,
          preferredLocale,
          includeDefaultBooleans,
        })
      )
      .filter(Boolean),
  };

  return compressed;
}

function compressFactSheetType(
  fst: any,
  opts: Required<CompressOptions>
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {
    key: fst.key,
    factSheetTypeConfig: fst.factSheetTypeConfig || {},
    translations: compressTranslations(fst.translations || {}, opts.includeAllTranslations, opts.preferredLocale),
    sections: [] as unknown[],
  };

  for (const section of fst.sections || []) {
    if (!opts.includeHidden && section.key === 'DEFAULT_SECTION') continue;
    if (!opts.includeHidden && section.visible === false) continue;

    const compressedSection = compressSection(section, opts);
    if (compressedSection) {
      (result.sections as unknown[]).push(compressedSection);
    }
  }

  return result;
}

function compressSection(section: any, opts: Required<CompressOptions>): Record<string, unknown> | null {
  const result: Record<string, unknown> = {
    key: section.key,
    translations: compressTranslations(section.translations || {}, opts.includeAllTranslations, opts.preferredLocale),
    subsections: [] as unknown[],
  };

  for (const subsection of section.subsections || []) {
    if (!opts.includeHidden && subsection.visible === false) continue;

    // Filter out REVERSE relations
    if (!opts.includeReverseRelations && subsection.type === 'RELATION') {
      if (subsection.direction === 'REVERSE') continue;
    }

    const compressedSub = compressSubsection(subsection, opts);
    if (compressedSub) {
      (result.subsections as unknown[]).push(compressedSub);
    }
  }

  return (result.subsections as unknown[]).length > 0 ? result : null;
}

function compressSubsection(subsection: any, opts: Required<CompressOptions>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    key: subsection.key,
    type: subsection.type,
    translations: compressTranslations(subsection.translations || {}, opts.includeAllTranslations, opts.preferredLocale),
  };

  // Relation-specific fields
  if (subsection.type === 'RELATION') {
    if (subsection.from) result.from = subsection.from;
    if (subsection.to) result.to = subsection.to;
    if (subsection.name) result.name = subsection.name;
    if (subsection.direction) result.direction = subsection.direction;
  }

  // Compress fields
  const fields: unknown[] = [];
  for (const field of subsection.fields || []) {
    if (!opts.includeHidden && field.visible === false) continue;
    fields.push(compressField(field, opts));
  }

  if (fields.length > 0) {
    result.fields = fields;
  }

  return result;
}

function compressField(field: any, opts: Required<CompressOptions>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    key: field.key,
    type: field.type,
    translations: compressTranslations(field.translations || {}, opts.includeAllTranslations, opts.preferredLocale),
  };

  // Allowed values
  if (field.values && field.values.length > 0) {
    result.values = field.values.map((v: any) => ({
      key: v.key,
      translations: compressTranslations(v.translations || {}, opts.includeAllTranslations, opts.preferredLocale),
    }));
  }

  // Boolean flags
  if (opts.includeDefaultBooleans) {
    result.inFacet = field.inFacet || false;
    result.inView = field.inView || false;
    result.readOnly = field.readOnly || false;
    result.mandatory = field.mandatory || false;
  } else {
    if (field.inFacet) result.inFacet = true;
    if (field.inView) result.inView = true;
    if (field.readOnly) result.readOnly = true;
    if (field.mandatory) result.mandatory = true;
  }

  if (field.renderType) result.renderType = field.renderType;
  if (field.size !== undefined && field.size !== 12) result.size = field.size;

  // Metadata
  const metadata = field.metadata || {};
  if (opts.includeEmptyMetadata || Object.keys(metadata).length > 0) {
    const filtered = Object.fromEntries(
      Object.entries(metadata).filter(([, v]) => v != null)
    );
    if (Object.keys(filtered).length > 0) {
      result.metadata = filtered;
    }
  }

  return result;
}

function compressTranslations(
  translations: Record<string, unknown>,
  includeAll: boolean,
  preferredLocale: string
): Record<string, unknown> {
  if (!translations || Object.keys(translations).length === 0) {
    return {};
  }

  if (includeAll) {
    return translations;
  }

  // Keep only preferred locale
  const localeData = translations[preferredLocale];
  if (localeData) {
    return { [preferredLocale]: localeData };
  }

  // Fallback to first available
  const firstKey = Object.keys(translations)[0];
  if (firstKey) {
    return { [firstKey]: translations[firstKey] };
  }

  return {};
}
