import { fs, path, SQLa_orch as o, SQLa_orch_duckdb as ddbo } from "./deps.ts";
import * as sg from "./governance.ts";

// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.1/package/types/index.d.ts"
import * as xlsx from "https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs";

export const excelWorkbookSheetNames = [
  "Admin_Demographic",
  "Screening",
  "QE_Admin_Data",
] as const;
export type ExcelWorkbookSheetName = typeof excelWorkbookSheetNames[number];

export class ExcelSheetTodoIngestSource<SheetName extends string>
  implements
  o.ExcelSheetIngestSource<
    SheetName,
    string,
    ddbo.DuckDbOrchGovernance,
    ddbo.DuckDbOrchEmitContext
  > {
  readonly nature = "Excel Workbook Sheet";
  readonly tableName: string;
  constructor(
    readonly uri: string,
    readonly sheetName: SheetName,
    readonly govn: ddbo.DuckDbOrchGovernance,
  ) {
    this.tableName = govn.toSnakeCase(
      path.basename(uri, ".xlsx") + "_" + sheetName,
    );
  }

  // deno-lint-ignore require-await
  async workflow(): ReturnType<
    o.ExcelSheetIngestSource<
      string,
      string,
      ddbo.DuckDbOrchGovernance,
      ddbo.DuckDbOrchEmitContext
    >["workflow"]
  > {
    return {
      ingestSQL: async (issac) =>
        // deno-fmt-ignore
        this.govn.SQL`
          -- required by IngestEngine, setup the ingestion entry for logging
          ${await issac.sessionEntryInsertDML()}
        
          ${await issac.issueInsertDML(`Excel workbook '${path.basename(this.uri)}' sheet '${this.sheetName}' has not been implemented yet.`, "TODO")}`,

      assuranceSQL: () =>
        this.govn.SQL`-- Sheet '${this.sheetName}' ingestion not implemented.`,

      exportResourceSQL: (targetSchema: string) =>
        this.govn.SQL`
          --  Sheet '${this.sheetName}' exportResourceSQL(${targetSchema})`,
    };
  }
}

export class ScreeningExcelSheetIngestSource<TableName extends string>
  implements
  o.ExcelSheetIngestSource<
    "Screening",
    TableName,
    ddbo.DuckDbOrchGovernance,
    ddbo.DuckDbOrchEmitContext
  > {
  readonly nature = "Excel Workbook Sheet";
  readonly sheetName = "Screening";
  readonly tableName: TableName;
  constructor(
    readonly uri: string,
    readonly govn: ddbo.DuckDbOrchGovernance,
  ) {
    this.tableName = govn.toSnakeCase(
      path.basename(uri, ".xlsx") + "_" + this.sheetName,
    ) as TableName;
  }

  async workflow(
    session: o.OrchSession<
      ddbo.DuckDbOrchGovernance,
      ddbo.DuckDbOrchEmitContext
    >,
    sessionEntryID: string,
  ): ReturnType<
    o.ExcelSheetIngestSource<
      "Screening",
      TableName,
      ddbo.DuckDbOrchGovernance,
      ddbo.DuckDbOrchEmitContext
    >["workflow"]
  > {
    const sessionDML = await session.orchSessionSqlDML();
    const sar = new sg.ScreeningAssuranceRules(
      this.tableName,
      sessionDML.sessionID,
      sessionEntryID,
      this.govn,
    );

    return {
      ingestSQL: async (issac) => await this.ingestSQL(session, issac, sar),
      assuranceSQL: async () => await this.assuranceSQL(session, sar),
      exportResourceSQL: async (targetSchema) =>
        await this.exportResourceSQL(session, sar.sessionEntryID, targetSchema),
    };
  }

  async ingestSQL(
    session: o.OrchSession<
      ddbo.DuckDbOrchGovernance,
      ddbo.DuckDbOrchEmitContext
    >,
    issac: o.IngestSourceStructAssuranceContext<ddbo.DuckDbOrchEmitContext>,
    sar: sg.ScreeningAssuranceRules<string>,
  ) {
    const { sheetName, tableName, uri } = this;
    const { sessionID, sessionEntryID } = sar;

    // deno-fmt-ignore
    return this.govn.SQL`
      -- required by IngestEngine, setup the ingestion entry for logging
      ${await issac.sessionEntryInsertDML()}
     
      -- state management diagnostics 
      ${await session.entryStateDML(sessionEntryID, "NONE", "ATTEMPT_EXCEL_INGEST", "ScreeningExcelSheetIngestSource.ingestSQL", this.govn.emitCtx.sqlEngineNow)}

      -- ingest Excel workbook sheet '${sheetName}' into ${tableName} using spatial plugin
      INSTALL spatial; LOAD spatial;

      -- be sure to add src_file_row_number and session_id columns to each row
      -- because assurance CTEs require them
      CREATE TABLE ${tableName} AS
        SELECT *, row_number() OVER () as src_file_row_number, '${sessionID}' as session_id, '${sessionEntryID}' as session_entry_id
          FROM st_read('${uri}', layer='${sheetName}', open_options=['HEADERS=FORCE', 'FIELD_TYPES=AUTO']);          
      
      ${sar.requiredColumnNames()}
      ${await session.entryStateDML(sessionEntryID, "ATTEMPT_EXCEL_INGEST", "INGESTED_EXCEL_WORKBOOK_SHEET", "ScreeningExcelSheetIngestSource.ingestSQL", this.govn.emitCtx.sqlEngineNow)}
      `
  }

  async assuranceSQL(
    session: o.OrchSession<
      ddbo.DuckDbOrchGovernance,
      ddbo.DuckDbOrchEmitContext
    >,
    sar: sg.ScreeningAssuranceRules<TableName>,
  ) {
    const { sessionEntryID } = sar;

    // deno-fmt-ignore
    return this.govn.SQL`
      ${await session.entryStateDML(sessionEntryID, "INGESTED_EXCEL_WORKBOOK_SHEET", "ATTEMPT_EXCEL_WORKBOOK_SHEET_ASSURANCE", "ScreeningExcelSheetIngestSource.assuranceSQL", this.govn.emitCtx.sqlEngineNow)}
      -- Sheet '${this.sheetName}' has no assurance SQL in Excel workbook '${path.basename(this.uri)}'      
      ${sar.tableRules.mandatoryValueInAllRows("PAT_MRN_ID")}
      ${sar.tableRules.intValueInAllRows("PAT_MRN_ID")}
      ${sar.tableRules.mandatoryValueInAllRows("SCREENING_NAME")}
      ${sar.tableRules.mandatoryValueInAllRows("SCREENING_CODE_SYSTEM_NAME")}
      ${sar.tableRules.mandatoryValueInAllRows("SCREENING_CODE")}
      ${sar.tableRules.onlyAllowedValuesInAllRows("SCREENING_METHOD", "In-Person,Phone,Website")}
      ${sar.tableRules.mandatoryValueInAllRows("RECORDED_TIME")} 
      ${sar.onlyAllowValidTimeInAllRows("RECORDED_TIME")}
      ${sar.tableRules.mandatoryValueInAllRows("QUESTION")}
      ${sar.tableRules.mandatoryValueInAllRows("MEAS_VALUE")}            
      ${sar.tableRules.mandatoryValueInAllRows("QUESTION_CODE")}
      ${sar.tableRules.onlyAllowedValuesInAllRows("QUESTION_CODE", "71802-3,96778-6")}
      ${sar.tableRules.mandatoryValueInAllRows("QUESTION_CODE_SYSTEM_NAME")}
      ${sar.tableRules.onlyAllowedValuesInAllRows("QUESTION_CODE_SYSTEM_NAME", "LN,LOIN")}
      ${sar.tableRules.mandatoryValueInAllRows("ANSWER_CODE")}
      ${sar.tableRules.mandatoryValueInAllRows("ANSWER_CODE_SYSTEM_NAME")}
      ${sar.tableRules.onlyAllowedValuesInAllRows("ANSWER_CODE_SYSTEM_NAME", "LN,LOIN")}
      ${sar.tableRules.mandatoryValueInAllRows("PARENT_QUESTION_CODE")}
      ${sar.tableRules.onlyAllowedValuesInAllRows("PARENT_QUESTION_CODE", "88122-7,88123-5")}
      ${sar.tableRules.mandatoryValueInAllRows("SDOH_DOMAIN")}
      ${sar.tableRules.mandatoryValueInAllRows("POTENTIAL_NEED_INDICATED")}
      ${sar.tableRules.onlyAllowedValuesInAllRows("POTENTIAL_NEED_INDICATED", "TRUE,FALSE")}
      ${sar.tableRules.onlyAllowedValuesInAllRows("ASSISTANCE_REQUESTED", "YES,NO")}            
      ${await session.entryStateDML(sessionEntryID, "ATTEMPT_EXCEL_WORKBOOK_SHEET_ASSURANCE", "ASSURED_EXCEL_WORKBOOK_SHEET", "ScreeningExcelSheetIngestSource.assuranceSQL", this.govn.emitCtx.sqlEngineNow)}
    `;
  }

  async exportResourceSQL(
    session: o.OrchSession<
      ddbo.DuckDbOrchGovernance,
      ddbo.DuckDbOrchEmitContext
    >,
    sessionEntryID: string,
    targetSchema: string,
  ) {
    const { govn } = this;

    // deno-fmt-ignore
    return govn.SQL`
      ${await session.entryStateDML(sessionEntryID, "ASSURED_EXCEL_WORKBOOK_SHEET", "ATTEMPT_EXCEL_WORKBOOK_SHEET_EXPORT", "ScreeningExcelSheetIngestSource.exportResourceSQL", this.govn.emitCtx.sqlEngineNow)}
      -- Sheet '${this.sheetName}' exportResourceSQL(${targetSchema})
      ${await session.entryStateDML(sessionEntryID, "ATTEMPT_EXCEL_WORKBOOK_SHEET_EXPORT", "EXPORTED_EXCEL_WORKBOOK_SHEET", "ScreeningExcelSheetIngestSource.exportResourceSQL", this.govn.emitCtx.sqlEngineNow)}
    `;
  }
}

export function ingestExcelSourcesSupplier(
  govn: ddbo.DuckDbOrchGovernance,
): o.IngestFsPatternSourcesSupplier<
  | ScreeningExcelSheetIngestSource<string>
  | ExcelSheetTodoIngestSource<string>
  | o.ErrorIngestSource<ddbo.DuckDbOrchGovernance, ddbo.DuckDbOrchEmitContext>
> {
  return {
    pattern: path.globToRegExp("**/*.xlsx", {
      extended: true,
      globstar: true,
    }),
    sources: (entry: fs.WalkEntry) => {
      const uri = entry.path;
      const sources: (
        | ScreeningExcelSheetIngestSource<string>
        | ExcelSheetTodoIngestSource<string>
        | o.ErrorIngestSource<
          ddbo.DuckDbOrchGovernance,
          ddbo.DuckDbOrchEmitContext
        >
      )[] = [];

      const sheetsExpected: Record<
        ExcelWorkbookSheetName,
        () =>
          | ExcelSheetTodoIngestSource<string>
          | ScreeningExcelSheetIngestSource<string>
      > = {
        "Admin_Demographic": () =>
          new ExcelSheetTodoIngestSource(
            uri,
            "Admin_Demographic",
            govn,
          ),
        "Screening": () => new ScreeningExcelSheetIngestSource(uri, govn),
        "QE_Admin_Data": () =>
          new ExcelSheetTodoIngestSource(uri, "QE_Admin_Data", govn),
      };

      try {
        const wb = xlsx.readFile(entry.path);

        // deno-fmt-ignore
        const sheetNotFound = (name: string) =>
          Error(`Excel workbook sheet '${name}' not found in '${path.basename(entry.path)}' (available: ${wb.SheetNames.join(", ")})`);

        let sheetsFound = 0;
        const expectedSheetNames = Object.keys(sheetsExpected);
        for (const expectedSN of expectedSheetNames) {
          if (wb.SheetNames.find((sn) => sn == expectedSN)) {
            sheetsFound++;
          } else {
            sources.push(
              new o.ErrorIngestSource<
                ddbo.DuckDbOrchGovernance,
                ddbo.DuckDbOrchEmitContext
              >(
                uri,
                sheetNotFound(expectedSN),
                "Sheet Missing",
                govn,
              ),
            );
          }
        }

        if (expectedSheetNames.length == sheetsFound) {
          for (const newSourceInstance of Object.values(sheetsExpected)) {
            sources.push(newSourceInstance());
          }
        }
      } catch (err) {
        sources.push(
          new o.ErrorIngestSource<
            ddbo.DuckDbOrchGovernance,
            ddbo.DuckDbOrchEmitContext
          >(entry.path, err, "ERROR", govn),
        );
      }
      return sources;
    },
  };
}
