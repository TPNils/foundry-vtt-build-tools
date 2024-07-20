declare module '@foundryvtt/foundryvtt-cli' {
  export type DocumentType = "Actor"|"Adventure"|"Cards"|"ChatMessage"|"Combat"|"FogExploration"|"Folder"|"Item"|"JournalEntry"|"Macro"|"Playlist"|"RollTable"|"Scene"|"Setting"|"User"
  
  export interface PackageOptions {
    /** Whether to operate on a NeDB database, otherwise a LevelDB database is assumed. */
    nedb?: true;
    /** Whether the source files are in YAML format, otherwise JSON is assumed. */
    yaml?: true;
    /** Whether to log operation progress to the console. */
    log?: true;
    /** A function that is called on every entry to transform it. */
    transformEntry?: EntryTransformer;
  }
  
  export interface CompileOptions extends PackageOptions {
    /** Whether to recurse into child directories to locate source files, otherwise only source files located in the root directory will be used. */
    recursive?: true;
  }
  
  export type ExtractOptions = Omit<PackageOptions, 'nedb'> & {
    /** Options to pass to yaml.dump when serializing Documents. */
    yamlOptions?: object;
    /** Options to pass to JSON.stringify when serializing Documents. */
    jsonOptions?: JSONOptions;
    /** Delete the destination directory before unpacking. */
    clean?: true;
    /** A function that is used to generate a filename for the extracted Document.
     * If used, the generated name must include the appropriate file extension.
     * The generated name will be resolved against the root path provided
     * to the operation, and the entry will be written to that resolved location.
     */
    transformName?: NameTransformer;
  } & (
    {
      /** Whether to operate on a NeDB database, otherwise a LevelDB database is assumed. */
      nedb: true;
      /** Required only for NeDB packs in order to generate a correct key. Can be used instead of documentType if known. */
      documentType: DocumentType;
      /** Required only for NeDB packs in order to generate a correct key. Can be used instead of documentType if known. */
      collection: DocumentCollection;
    } |
    {
      /** Whether to operate on a NeDB database, otherwise a LevelDB database is assumed. */
      nedb?: false;
      /** Required only for NeDB packs in order to generate a correct key. Can be used instead of documentType if known. */
      documentType?: DocumentType;
      /** Required only for NeDB packs in order to generate a correct key. Can be used instead of documentType if known. */
      collection?: DocumentCollection;
    }
  )
  
  export interface JSONOptions {
    /** A replacer function or an array of property names in the object to include in the resulting string. */
    replacer?: JSONReplacer | Array<string | number>;
    /** A number of spaces or a string to use as indentation. */
    space?: string | number;
  }

  /**
   * @param key    The key being stringified.
   * @param value  The value being stringified.
   * @returns      The value returned is substituted instead of the current property's value.
   */
  export type JSONReplacer = (key: string, value: any) => any;
  

  /**
   * @param entry  The entry data.
   * @returns      Return boolean false to indicate that this entry should be discarded.
   */
  export type EntryTransformer<T extends object> = (entity: T) => Promise<false | void>;
  
  /**
   * @param entry  The entry data.
   * @returns      If a string is returned, it is used as the filename that the entry will be written to.
   */
  export type NameTransformer<T extends object> = (entity: T) => Promise<string | void>;

  /**
   * @param doc         The Document being operated on.
   * @param collection  The Document's collection.
   * @param options     Additional options supplied by the invocation on the level above this one.
   * @returns           Options to supply to the next level of the hierarchy.
   */
  export type HierarchyApplyCallback<T extends object> = (doc: T, collection: string, options?: object) => Promise<string | void>;
 
 /**
  * @param entry       The element stored in the collection.
  * @param collection  The collection name.
  */
  export type HierarchyMapCallback<T extends object> = (doc: T, collection: string, options?: object) => Promise<any>;

/**
 * Compile source files into a compendium pack.
 * @param src      The directory containing the source files.
 * @param dest     The target compendium pack. This should be a directory for LevelDB packs, or a .db file for NeDB packs.
 * @param options
 */
  export function compilePack(src: string, dest: string, options?: CompileOptions): Promise<void>;
  
  /**
   * Extract the contents of a compendium pack into individual source files for each primary Document.
   * @param src      The source compendium pack. This should be a directory for LevelDB pack, or a .db file for NeDB packs.
   * @param dest     The directory to write the extracted files into.
   * @param options
   */
  export function extractPack(src: string, dest: string, options?: ExtractOptions): Promise<void>;
}