import {it,expect} from 'vitest';import {assembleCampaignTransferStructuralCandidate} from './campaign-transfer-candidate.js';
it('rejects forged drafts before filesystem access',async()=>{await expect(assembleCampaignTransferStructuralCandidate({root:'C:/',mediaRoot:'C:/'})).rejects.toThrow('UNOWNED');});
