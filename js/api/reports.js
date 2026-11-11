import { rpc } from './base.js';

export const homeSummary = () => rpc('home_summary');
export const reportData = (fromDate, toDate) => rpc('report_data', { p_from: fromDate, p_to: toDate });
