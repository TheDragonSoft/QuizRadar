export interface RustField {
  /** The field name as written in Rust (`course_id`). */
  rustName: string;
  /** The key the field has on the wire (`course_id`, `date_iso`, `type`). */
  wireName: string;
  /** The raw Rust type (`String`, `Option<f64>`, `Vec<Course>`, …). */
  rustType: string;
  /** True when the Rust type is `Option<…>` (nullable on the wire). */
  optional: boolean;
}

export interface RustStruct {
  /** Repo-relative path of the Rust file the struct was read from. */
  source: string;
  fields: RustField[];
}

export interface RustVariant {
  /** The variant name as written in Rust (`ClassQuiz`). */
  name: string;
  /** The label serde emits (`Class Quiz`). */
  wireName: string;
}

export interface RustEnum {
  source: string;
  variants: RustVariant[];
}

export interface FfiExport {
  parameters: string[];
  returns: string;
}

export interface RustContract {
  generatedBy: string;
  note: string;
  sourceFiles: string[];
  sourceHashes: Record<string, string>;
  structs: Record<string, RustStruct>;
  enums: Record<string, RustEnum>;
  enumLabels: Record<string, string[]>;
  ffiExports: Record<string, FfiExport>;
}

export declare const STRUCT_SOURCES: string[];
export declare const ENUM_SOURCES: string[];
export declare const LABEL_SOURCES: Array<{
  file: string;
  function: string;
  impl?: string;
  label: string;
}>;
export declare const FFI_SOURCE: string;
export declare function buildContract(readFile: (file: string) => string): RustContract;

export declare function camelCase(name: string): string;
export declare function hashSource(text: string): string;
export declare function stringLiterals(text: string): string[];
export declare function matchingParen(text: string, openIndex: number): number;
export declare function functionBody(source: string, functionName: string): string | null;
export declare function implBlock(source: string, implType: string): string | null;
export declare function extractStructs(source: string, file: string): Record<string, RustStruct>;
export declare function extractEnums(source: string, file: string): Record<string, RustEnum>;
export declare function extractMatchLabels(
  source: string,
  functionName: string,
  implType?: string,
): string[];
export declare function extractFfiExports(source: string): Record<string, FfiExport>;
