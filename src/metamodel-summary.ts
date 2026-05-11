/**
 * Metamodel Summary Builder
 *
 * Builds a structured summary from the compressed LeanIX metamodel,
 * resolving English translations into display names. Supports all-types
 * mode (compact) and single-type mode (full detail).
 */

import { LeanIXClient } from './leanix-client.js';

interface TranslationsMap {
  [locale: string]: Record<string, string | undefined>;
}

/**
 * Extract the best English display label from a translations dict.
 */
function enName(translations: unknown): string {
  if (!translations || typeof translations !== 'object') return '';
  const t = translations as TranslationsMap;
  const localeData = t.en || Object.values(t).find((v) => v && typeof v === 'object') || {};
  if (typeof localeData !== 'object' || localeData === null) {
    return localeData ? String(localeData) : '';
  }
  const ld = localeData as Record<string, string | undefined>;
  return ld.factSheetTypeName || ld.name || ld.shortName || '';
}

/**
 * Extract the best English description from a translations dict.
 */
function enDesc(translations: unknown): string {
  if (!translations || typeof translations !== 'object') return '';
  const t = translations as TranslationsMap;
  const localeData = t.en || Object.values(t).find((v) => v && typeof v === 'object') || {};
  if (typeof localeData !== 'object' || localeData === null) return '';
  const ld = localeData as Record<string, string | undefined>;
  return ld.description || ld.helpText || '';
}

export interface MetamodelSummary {
  overview: string;
  factsheet_types: Record<string, any>;
  relations: Record<string, any>;
  statistics: { total_factsheet_types: number; total_unique_relations: number };
}

/**
 * Build a human-readable metamodel summary.
 *
 * @param client - Authenticated LeanIX client
 * @param factsheetType - When provided, return only that single type with all attributes.
 *                        When undefined, return all types in compact mode.
 */
export async function getMetamodelSummary(
  client: LeanIXClient,
  factsheetType?: string
): Promise<MetamodelSummary> {
  const metamodelResponse = await client.getMetamodel({ compressed: true });

  // Extract factSheetTypes list
  let factSheetTypesList: any[] = [];
  if (Array.isArray((metamodelResponse as any).factSheetTypes)) {
    factSheetTypesList = (metamodelResponse as any).factSheetTypes;
  } else if ((metamodelResponse as any).data?.factSheetTypes) {
    factSheetTypesList = (metamodelResponse as any).data.factSheetTypes;
  }

  const summary: MetamodelSummary = {
    overview: 'LeanIX Metamodel Summary',
    factsheet_types: {},
    relations: {},
    statistics: { total_factsheet_types: 0, total_unique_relations: 0 },
  };

  const allRelations: Record<string, any> = {};
  const singleMode = factsheetType !== undefined;

  for (const fsType of factSheetTypesList) {
    const fsKey: string = fsType.key || 'unknown';

    // In single-type mode, skip other types
    if (singleMode && fsKey !== factsheetType) continue;

    const fsDisplay = enName(fsType.translations) || fsKey;
    const fsDesc = enDesc(fsType.translations) || '';

    const fields: Record<string, any> = {};
    const fsRelations: Record<string, any> = {};

    for (const section of fsType.sections || []) {
      const sectionName = enName(section.translations) || section.key || '';

      for (const subsection of section.subsections || []) {
        const subType = subsection.type;
        const subDisplay = enName(subsection.translations) || subsection.key || '';

        if (subType === 'FIELD') {
          for (const field of subsection.fields || []) {
            const fieldKey: string = field.key || '';
            if (!fieldKey) continue;

            // In all-types mode, skip lx-prefixed internal custom fields
            if (!singleMode && fieldKey.startsWith('lx')) continue;

            const fieldDisplay = enName(field.translations) || fieldKey;

            const fieldInfo: Record<string, any> = {
              display_name: fieldDisplay,
              type: field.type || '',
              section: sectionName,
            };
            if (field.mandatory) fieldInfo.mandatory = true;
            if (field.readOnly) fieldInfo.readOnly = true;
            // inFacet flag only in single-type mode
            if (singleMode && field.inFacet) fieldInfo.inFacet = true;
            if (field.renderType) fieldInfo.renderType = field.renderType;
            if (field.values && field.values.length > 0) {
              fieldInfo.values = field.values.map((v: any) => ({
                key: v.key,
                display_name: enName(v.translations) || v.key,
              }));
            }
            fields[fieldKey] = fieldInfo;
          }
        } else if (subType === 'RELATION') {
          const relName: string = subsection.name || subsection.key || '';
          const fromRaw = subsection.from || {};
          const toRaw = subsection.to || {};

          const fromType = typeof fromRaw === 'object' ? fromRaw.factSheetType || '' : String(fromRaw);
          const toType = typeof toRaw === 'object' ? toRaw.factSheetType || '' : String(toRaw);

          const relEntry: Record<string, any> = {
            display_name: subDisplay,
            from_type: fromType,
            to_type: toType,
          };
          if (typeof fromRaw === 'object' && fromRaw.cardinality) {
            relEntry.from_cardinality = fromRaw.cardinality;
          }
          if (typeof toRaw === 'object' && toRaw.cardinality) {
            relEntry.to_cardinality = toRaw.cardinality;
          }

          fsRelations[relName] = relEntry;

          // Global dedup (first occurrence wins)
          if (relName && !allRelations[relName]) {
            allRelations[relName] = relEntry;
          }
        }
      }
    }

    summary.factsheet_types[fsKey] = {
      display_name: fsDisplay,
      description: fsDesc,
      fields,
      relations: fsRelations,
    };
  }

  summary.relations = allRelations;
  summary.statistics = {
    total_factsheet_types: Object.keys(summary.factsheet_types).length,
    total_unique_relations: Object.keys(allRelations).length,
  };

  return summary;
}
