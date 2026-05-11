/**
 * CSV Encoder for LeanIX Metamodel
 *
 * Encodes the metamodel summary as flat CSV tables:
 *   ## FACTSHEET TYPES
 *   ## FIELDS
 *   ## RELATIONS
 */

interface MetamodelSummary {
  factsheet_types: Record<string, FactSheetTypeSummary>;
  relations: Record<string, RelationSummary>;
  statistics: { total_factsheet_types: number; total_unique_relations: number };
}

interface FactSheetTypeSummary {
  display_name: string;
  description: string;
  fields: Record<string, FieldSummary>;
  relations: Record<string, RelationSummary>;
}

interface FieldSummary {
  display_name: string;
  type: string;
  section: string;
  mandatory?: boolean;
  readOnly?: boolean;
  inFacet?: boolean;
  renderType?: string;
  values?: { key: string; display_name: string }[];
}

interface RelationSummary {
  display_name: string;
  from_type: string;
  to_type: string;
  from_cardinality?: string;
  to_cardinality?: string;
}

/**
 * Escape a CSV field value. Wraps in quotes if it contains comma, quote, or newline.
 */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRow(fields: string[]): string {
  return fields.map(csvEscape).join(',');
}

export function encodeMetamodelToCsv(metamodel: MetamodelSummary): string {
  const stats = metamodel.statistics || {};
  const nTypes = stats.total_factsheet_types || Object.keys(metamodel.factsheet_types || {}).length;
  const nRels = stats.total_unique_relations || 0;
  const headerComment = `# LeanIX Metamodel — ${nTypes} fact sheet types, ${nRels} unique relations`;

  // ── FACTSHEET TYPES ──
  const typeCols = ['type_key', 'display_name', 'description'];
  const typeRows: string[] = [csvRow(typeCols)];
  for (const [fsKey, fsData] of Object.entries(metamodel.factsheet_types || {})) {
    typeRows.push(csvRow([fsKey, fsData.display_name || '', fsData.description || '']));
  }

  // ── FIELDS ──
  const fieldCols = ['type', 'field_key', 'display_name', 'field_type', 'section', 'mandatory', 'readonly', 'infacet', 'values'];
  const fieldRows: string[] = [csvRow(fieldCols)];
  for (const [fsKey, fsData] of Object.entries(metamodel.factsheet_types || {})) {
    for (const [fieldKey, field] of Object.entries(fsData.fields || {})) {
      const valuesStr = (field.values || []).map((v) => v.key).join('|');
      fieldRows.push(
        csvRow([
          fsKey,
          fieldKey,
          field.display_name || '',
          field.type || '',
          field.section || '',
          field.mandatory ? '1' : '',
          field.readOnly ? '1' : '',
          field.inFacet ? '1' : '',
          valuesStr,
        ])
      );
    }
  }

  // ── RELATIONS ──
  const relCols = ['relation_key', 'display_name', 'from_type', 'to_type', 'from_cardinality', 'to_cardinality'];
  const relRows: string[] = [csvRow(relCols)];
  const globalRels = metamodel.relations || {};
  if (Object.keys(globalRels).length > 0) {
    for (const [relKey, rel] of Object.entries(globalRels)) {
      relRows.push(
        csvRow([relKey, rel.display_name || '', rel.from_type || '', rel.to_type || '', rel.from_cardinality || '', rel.to_cardinality || ''])
      );
    }
  } else {
    // Fallback: deduplicate from per-type relations
    const seen = new Set<string>();
    for (const fsData of Object.values(metamodel.factsheet_types || {})) {
      for (const [relKey, rel] of Object.entries(fsData.relations || {})) {
        if (!seen.has(relKey)) {
          seen.add(relKey);
          relRows.push(
            csvRow([relKey, rel.display_name || '', rel.from_type || '', rel.to_type || '', rel.from_cardinality || '', rel.to_cardinality || ''])
          );
        }
      }
    }
  }

  return [
    headerComment,
    '',
    '## FACTSHEET TYPES',
    typeRows.join('\n'),
    '',
    '## FIELDS',
    fieldRows.join('\n'),
    '',
    '## RELATIONS',
    relRows.join('\n'),
  ].join('\n');
}
