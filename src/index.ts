import * as mimeDb from 'mime-db'
import * as PostalMime from 'postal-mime'

import * as pako from 'pako'
import * as unzipit from 'unzipit'

import { XMLParser } from 'fast-xml-parser'

import {
  AlignmentType,
  Attachment,
  DMARCResultType,
  DispositionType,
  DmarcRecordRow,
  Env,
  PolicyOverrideType,
} from './types'

export default {
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env, ctx)
  },
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleEmail(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const parser = new PostalMime.default()

  // parse email content
  const rawEmail = new Response(message.raw)

  const email = await parser.parse(await rawEmail.arrayBuffer())

  // get attachment
  if (email.attachments === null || email.attachments.length === 0) {
    throw new Error('no attachments')
  }
  const attachment = email.attachments[0]

  // get xml
  const reportJSON = await getDMARCReportXML(attachment)

  // get report
  const report = getReportRows(reportJSON)

  // send to analytics engine
  await sendToSplunk(env, report)
}

async function sendToSplunk(env: Env, reportRows: DmarcRecordRow[]) {
  const payload = reportRows.map(report => ({
    event: report
  }))
  const resp = await fetch(env.HEC_URL, {method: 'POST', body: JSON.stringify(payload), headers:{'Authorization': `Splunk ${env.HEC_TOKEN}`}})
  console.log(await resp.json())
}

async function getDMARCReportXML(attachment: Attachment) {
  let xml
  const xmlParser = new XMLParser()
  const extension = mimeDb[attachment.mimeType]?.extensions?.[0] || ''

  switch (extension) {
    case 'gz':
      xml = pako.inflate(new TextEncoder().encode(attachment.content as string), { to: 'string' })
      break

    case 'zip':
      xml = await getXMLFromZip(attachment.content)
      break

    case 'xml':
      xml = await new Response(attachment.content).text()
      break

    default:
      throw new Error(`unknown extension: ${extension}`)
  }

  return await xmlParser.parse(xml)
}

async function getXMLFromZip(content: string | ArrayBuffer | Blob | unzipit.TypedArray | unzipit.Reader) {
  const { entries } = await unzipit.unzipRaw(content)
  if (entries.length === 0) {
    return new Error('no entries in zip')
  }

  return await entries[0].text()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReportRows(report: any): DmarcRecordRow[] {
  const reportMetadata = report.feedback.report_metadata
  const policyPublished = report.feedback.policy_published
  const records = Array.isArray(report.feedback.record) ? report.feedback.record : [report.feedback.record]

  if (!report.feedback || !reportMetadata || !policyPublished || !records) {
    throw new Error('invalid xml')
  }

  const listEvents: DmarcRecordRow[] = []

  for (let index = 0; index < records.length; index++) {
    const record = records[index]

    const reportRow: DmarcRecordRow = {
      reportMetadataReportId: reportMetadata.report_id.toString().replace('-', '_'),
      reportMetadataOrgName: reportMetadata.org_name || '',
      reportMetadataDateRangeBegin: parseInt(reportMetadata.date_range.begin) || 0,
      reportMetadataDateRangeEnd: parseInt(reportMetadata.date_range.end) || 0,
      reportMetadataError: JSON.stringify(reportMetadata.error) || '',

      policyPublishedDomain: policyPublished.domain || '',
      policyPublishedADKIM: AlignmentType[policyPublished.adkim as keyof typeof AlignmentType],
      policyPublishedASPF: AlignmentType[policyPublished.aspf as keyof typeof AlignmentType],
      policyPublishedP: DispositionType[policyPublished.p as keyof typeof DispositionType],
      policyPublishedSP: DispositionType[policyPublished.sp as keyof typeof DispositionType],
      policyPublishedPct: parseInt(policyPublished.pct) || 0,

      recordRowSourceIP: record.row.source_ip || '',

      recordRowCount: parseInt(record.row.count) || 0,
      recordRowPolicyEvaluatedDKIM: DMARCResultType[record.row.policy_evaluated.dkim as keyof typeof DMARCResultType],
      recordRowPolicyEvaluatedSPF: DMARCResultType[record.row.policy_evaluated.spf as keyof typeof DMARCResultType],
      recordRowPolicyEvaluatedDisposition:
        DispositionType[record.row.policy_evaluated.disposition as keyof typeof DispositionType],

      recordRowPolicyEvaluatedReasonType:
        PolicyOverrideType[record.row.policy_evaluated?.reason?.type as keyof typeof PolicyOverrideType],
      recordIdentifiersEnvelopeTo: record.identifiers.envelope_to || '',
      recordIdentifiersHeaderFrom: record.identifiers.header_from || '',
    }

    listEvents.push(reportRow)
  }

  return listEvents
}
