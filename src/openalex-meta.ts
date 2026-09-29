/** OpenAlex 的出处常量（适配器与计数装配共用；单独成文件是为了不让两者互相 import 成环）。 */
export const OPENALEX_PROVENANCE = {
  source_label: 'OpenAlex',
  license: 'CC0 1.0',
} as const
