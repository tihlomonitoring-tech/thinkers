/**
 * Starter content templates for Letter composition (3 per letter type).
 * Seeded as global system templates (tenant_id NULL) and identified by a stable
 * seed_key so re-running the seeder is idempotent.
 *
 * Body text uses [Bracketed] merge placeholders the author fills in.
 */

const T = (template_name, description, intro_body, sections, closing_text) => ({
  template_name,
  description,
  intro_body,
  sections,
  closing_text,
});

export const LETTER_TEMPLATE_SEEDS = {
  warning: [
    T(
      'First written warning',
      'Formal first written warning citing company policy.',
      'This letter serves as a formal written warning regarding your conduct described below. It follows our earlier discussions and is issued in line with the company disciplinary code.',
      [
        { heading: 'Nature of the misconduct', body: 'On [date], it was established that you [describe the misconduct clearly and factually]. This conduct constitutes a breach of the standards expected of all employees.' },
        { heading: 'Applicable standard', body: 'Your conduct contravenes [refer to the relevant company policy/clause]. A copy of the applicable policy is available from Human Resources on request.' },
        { heading: 'Required corrective action', body: 'You are required to [state the expected behaviour] with immediate effect. You are reminded that you may be assisted by a fellow employee or representative.' },
        { heading: 'Consequence of repetition', body: 'Please note that any recurrence of this or similar misconduct within [period] may result in further disciplinary action, up to and including dismissal.' },
      ],
      'This warning will remain on your record for [period]. Please sign below to acknowledge receipt.\n\nYours faithfully,'
    ),
    T(
      'Final written warning',
      'Final written warning before dismissal.',
      'This letter constitutes a FINAL WRITTEN WARNING following the disciplinary enquiry held on [date]. It is issued in accordance with the company disciplinary procedure.',
      [
        { heading: 'Findings', body: 'Having considered all evidence, it was found that you [state the finding]. This is regarded as serious misconduct.' },
        { heading: 'Previous record', body: 'You have previously received [reference prior warnings/dates]. This conduct is therefore treated as a repeat offence.' },
        { heading: 'Final caution', body: 'This is your final written warning. Any further misconduct of any nature within [period] will result in disciplinary action that may lead to your dismissal.' },
        { heading: 'Right to appeal', body: 'You have the right to appeal this decision in writing to [name/role] within [x] working days of receiving this letter.' },
      ],
      'Please sign below to confirm that you have received and understood this final written warning.\n\nYours faithfully,'
    ),
    T(
      'Verbal warning confirmation',
      'Written confirmation of a verbal warning.',
      'This letter confirms the verbal warning issued to you on [date] regarding the matter set out below.',
      [
        { heading: 'Matter discussed', body: 'During our discussion, the following was raised: [describe the issue]. The purpose of this confirmation is to ensure there is a clear record of the matter.' },
        { heading: 'Expectation going forward', body: 'You are expected to [state the corrective behaviour]. Support is available should you require it.' },
      ],
      'This confirmation will be kept on file for [period].\n\nYours faithfully,'
    ),
    T(
      'Written warning — poor performance',
      'Addresses sub-standard work performance.',
      'This letter serves as a formal written warning regarding the standard of your work performance, which has remained below the required level despite prior counselling.',
      [
        { heading: 'Performance shortfall', body: 'Your performance in respect of [duties/targets] has not met the standard required, specifically [give measurable examples and dates].' },
        { heading: 'Support provided', body: 'You have been provided with [training/coaching/resources] to assist you. Notwithstanding this support, the required improvement has not been achieved.' },
        { heading: 'Improvement required', body: 'You are required to achieve [specific, measurable targets] by [date]. Your progress will be formally reviewed on [date].' },
      ],
      'Failure to improve to the required standard may result in further action, including incapacity proceedings.\n\nYours faithfully,'
    ),
    T(
      'Written warning — absenteeism',
      'Addresses excessive or unauthorised absence.',
      'This letter constitutes a written warning regarding your attendance record, which has become a matter of concern to the company.',
      [
        { heading: 'Attendance record', body: 'Our records reflect that you were absent on [list dates], a number of which were unauthorised or without acceptable explanation.' },
        { heading: 'Impact', body: 'Your absence places an unfair burden on your colleagues and disrupts operations. Regular attendance is a fundamental condition of your employment.' },
        { heading: 'Expectation', body: 'You are required to maintain regular attendance and to report any absence in accordance with the company attendance procedure. Any future absence must be supported by acceptable proof.' },
      ],
      'Continued absenteeism may result in further disciplinary action.\n\nYours faithfully,'
    ),
    T(
      'Written warning — timekeeping',
      'Addresses persistent late coming.',
      'This letter serves as a written warning in respect of your persistent failure to report for duty on time.',
      [
        { heading: 'Record of late coming', body: 'You reported late for duty on the following occasions: [list dates and times], despite previous reminders.' },
        { heading: 'Required standard', body: 'You are required to report for duty punctually at [time] and to be ready to commence work at the start of your shift.' },
      ],
      'Should late coming persist, further disciplinary action may follow.\n\nYours faithfully,'
    ),
    T(
      'Written warning — insubordination',
      'Addresses refusal to follow a lawful instruction.',
      'This letter constitutes a written warning following an incident of insubordination on [date].',
      [
        { heading: 'The incident', body: 'On [date], you [describe the refusal to obey a reasonable and lawful instruction, or disrespectful conduct toward a supervisor].' },
        { heading: 'Standard expected', body: 'You are reminded that you are required to carry out all reasonable and lawful instructions and to treat colleagues and management with respect.' },
      ],
      'Any repetition of this conduct may result in further disciplinary action, up to and including dismissal.\n\nYours faithfully,'
    ),
    T(
      'Written warning — safety breach',
      'Addresses a breach of health and safety rules.',
      'This letter serves as a formal written warning regarding your failure to comply with the health and safety requirements of the company.',
      [
        { heading: 'Safety breach', body: 'On [date], you [describe the unsafe act or omission, for example failure to wear PPE or follow a safe-work procedure].' },
        { heading: 'Why this matters', body: 'Compliance with safety rules is essential to protect you, your colleagues and the public. Breaches of this nature are treated as serious.' },
        { heading: 'Required action', body: 'You must comply fully with all safety rules and procedures at all times with immediate effect.' },
      ],
      'A further breach may result in more serious disciplinary action.\n\nYours faithfully,'
    ),
    T(
      'Written warning — misuse of company property',
      'Addresses unauthorised or improper use of company assets.',
      'This letter constitutes a written warning in respect of the misuse of company property.',
      [
        { heading: 'The conduct', body: 'It was established that you [describe the misuse, for example unauthorised use of a vehicle, equipment or systems] on [date].' },
        { heading: 'Company policy', body: 'Company assets must be used only for authorised business purposes and in accordance with company policy.' },
      ],
      'Any recurrence may lead to further disciplinary action.\n\nYours faithfully,'
    ),
    T(
      'Second written warning',
      'Escalation following an earlier valid warning.',
      'This letter constitutes a SECOND WRITTEN WARNING, issued following the written warning previously given to you on [date].',
      [
        { heading: 'Repeat conduct', body: 'Despite the earlier warning, you again [describe the misconduct] on [date]. This is treated as a repeat offence.' },
        { heading: 'Caution', body: 'You are cautioned that any further misconduct within [period] may result in a final written warning or dismissal.' },
        { heading: 'Right to representation', body: 'You may be assisted by a fellow employee or trade union representative in any further proceedings.' },
      ],
      'Please sign below to acknowledge receipt of this second written warning.\n\nYours faithfully,'
    ),
  ],
  reward: [
    T(
      'Outstanding performance recognition',
      'Recognises exceptional individual performance.',
      'It is with great pleasure that we recognise your outstanding contribution to [team/department/company] over the past [period].',
      [
        { heading: 'Achievement', body: 'In particular, we wish to acknowledge [describe the achievement, results, or behaviour]. Your effort has made a measurable and lasting impact.' },
        { heading: 'Reward', body: 'In recognition of this, the company is pleased to award you [describe reward — bonus, voucher, additional leave, etc.].' },
      ],
      'Thank you for your dedication and the example you set for your colleagues.\n\nWith appreciation,'
    ),
    T(
      'Employee of the month',
      'Employee of the month award letter.',
      'Congratulations! You have been selected as Employee of the Month for [month, year].',
      [
        { heading: 'Reasons for the award', body: 'This award recognises [describe the qualities, behaviours and results that led to the nomination].' },
        { heading: 'Token of appreciation', body: 'As a token of our appreciation, you will receive [describe reward]. Your name will also be displayed on the company recognition board.' },
      ],
      'We are proud to have you on the team.\n\nWarm regards,'
    ),
    T(
      'Long service award',
      'Recognises a service milestone.',
      'On behalf of the entire organisation, congratulations on reaching [x] years of dedicated service with [company].',
      [
        { heading: 'Appreciation', body: 'Your loyalty, professionalism and commitment over the years have contributed significantly to our success.' },
        { heading: 'Award', body: 'In recognition of this milestone, we are honoured to present you with [describe long service award].' },
      ],
      'Here is to many more years of shared success.\n\nWith gratitude,'
    ),
    T(
      'Spot bonus award',
      'Immediate recognition for a specific contribution.',
      'We are delighted to award you a spot bonus in recognition of your recent outstanding contribution.',
      [
        { heading: 'What we are recognising', body: 'This award acknowledges [describe the specific action, project or behaviour] and the positive impact it had on [team/customer/company].' },
        { heading: 'The award', body: 'A spot bonus of [amount] will be paid to you with your next salary payment.' },
      ],
      'Thank you for going the extra mile.\n\nWith appreciation,'
    ),
    T(
      'Performance bonus',
      'Bonus tied to performance against targets.',
      'In recognition of your strong performance during [period], we are pleased to award you a performance bonus.',
      [
        { heading: 'Performance achieved', body: 'You met or exceeded your agreed objectives, in particular [highlight key results and metrics].' },
        { heading: 'Bonus award', body: 'A performance bonus of [amount] has been approved and will be paid on [date], subject to applicable deductions.' },
      ],
      'Your results make a real difference. Well done.\n\nWith appreciation,'
    ),
    T(
      'Sales target achievement',
      'Recognises achievement of sales goals.',
      'Congratulations on achieving [exceeding] your sales target for [period].',
      [
        { heading: 'Results', body: 'You delivered [figures/percentage of target], a result that reflects exceptional commitment and skill.' },
        { heading: 'Reward', body: 'In recognition of this achievement, you will receive [commission/bonus/incentive details].' },
      ],
      'Keep up the excellent work.\n\nWarm regards,'
    ),
    T(
      'Innovation award',
      'Recognises a valuable idea or improvement.',
      'It is our pleasure to recognise you for an idea that has made a meaningful difference to the way we work.',
      [
        { heading: 'The innovation', body: 'Your suggestion to [describe the idea or improvement] has resulted in [describe the benefit, for example cost saving, efficiency or safety improvement].' },
        { heading: 'Recognition', body: 'In appreciation, we are pleased to present you with [describe award].' },
      ],
      'Thank you for thinking differently and helping us improve.\n\nWith appreciation,'
    ),
    T(
      'Team excellence award',
      'Recognises a high-performing team.',
      'On behalf of management, congratulations to the [team name] team on an outstanding achievement.',
      [
        { heading: 'Achievement', body: 'Together you delivered [describe the team result], demonstrating exceptional collaboration and commitment.' },
        { heading: 'Recognition', body: 'In recognition of this team effort, the company is pleased to provide [describe team reward].' },
      ],
      'Your teamwork sets the standard for the rest of the organisation.\n\nWith appreciation,'
    ),
    T(
      'Safety milestone reward',
      'Recognises a safety performance milestone.',
      'We are proud to recognise the achievement of [number] [days/hours] without a lost-time injury.',
      [
        { heading: 'Why it matters', body: 'This milestone reflects a genuine commitment to safe working practices and looking out for one another.' },
        { heading: 'Recognition', body: 'To celebrate this achievement, the company will [describe reward or celebration].' },
      ],
      'Let us keep safety first in everything we do.\n\nWith appreciation,'
    ),
    T(
      'Customer service excellence',
      'Recognises outstanding service to customers.',
      'We are pleased to recognise you for the exceptional service you provided to our customers.',
      [
        { heading: 'What you did', body: 'In particular, [describe the service or feedback received from a customer]. Your professionalism reflects very well on the company.' },
        { heading: 'Recognition', body: 'In appreciation of your service, we are pleased to award you [describe reward].' },
      ],
      'Thank you for representing us so well.\n\nWith appreciation,'
    ),
  ],
  employment_contract: [
    T(
      'Permanent employment contract',
      'Standard permanent contract of employment.',
      'This Contract of Employment is entered into between [Company] ("the Employer") and [Employee Full Name] ("the Employee").',
      [
        { heading: 'Position and duties', body: 'The Employee is appointed as [job title] and shall perform the duties reasonably associated with this position and any other lawful duties assigned from time to time.' },
        { heading: 'Commencement and probation', body: 'Employment commences on [date]. The first [x] months constitute a probationary period during which suitability for the role will be assessed.' },
        { heading: 'Remuneration', body: 'The Employee shall receive a gross remuneration of [amount] per [month/annum], payable monthly in arrears by electronic transfer.' },
        { heading: 'Hours of work', body: 'Ordinary hours of work are [hours] per week, [days]. Overtime, where applicable, will be compensated in accordance with the Basic Conditions of Employment Act.' },
        { heading: 'Leave', body: 'The Employee is entitled to [x] days annual leave, sick leave and family responsibility leave as prescribed by law and company policy.' },
        { heading: 'Termination', body: 'Either party may terminate this contract on [notice period] written notice, subject to the provisions of applicable labour legislation.' },
        { heading: 'Confidentiality', body: 'The Employee undertakes to keep confidential all proprietary and sensitive information belonging to the Employer, during and after employment.' },
      ],
      'Signed by the parties on the dates indicated below.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Fixed-term employment contract',
      'Contract for a defined period or project.',
      'This Fixed-Term Contract of Employment is concluded between [Company] and [Employee Full Name] for the period and purpose set out below.',
      [
        { heading: 'Purpose and duration', body: 'The Employee is engaged for [describe project/reason] from [start date] to [end date]. The contract terminates automatically on the end date without further notice.' },
        { heading: 'Position and remuneration', body: 'The Employee is appointed as [job title] at a remuneration of [amount] per [period].' },
        { heading: 'Early termination', body: 'Either party may terminate this contract before the end date on [notice period] written notice, save in cases of misconduct warranting summary termination.' },
        { heading: 'No expectation of renewal', body: 'The Employee acknowledges that this fixed-term contract creates no expectation of renewal or permanent employment.' },
      ],
      'Accepted and agreed by both parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Offer of employment',
      'Formal job offer letter.',
      'We are delighted to offer you the position of [job title] at [Company]. The principal terms of the offer are set out below.',
      [
        { heading: 'Remuneration and benefits', body: 'Your total cost to company will be [amount] per [period], together with [list benefits].' },
        { heading: 'Start date', body: 'Subject to your acceptance, your start date will be [date], reporting to [manager name and title].' },
        { heading: 'Conditions of offer', body: 'This offer is conditional upon [reference checks / qualifications verification / medical], and acceptance of the full contract of employment.' },
      ],
      'Please confirm your acceptance by signing and returning a copy of this letter by [date].\n\nWe look forward to welcoming you.\n\nYours sincerely,'
    ),
    T(
      'Part-time employment contract',
      'Contract for reduced or defined hours.',
      'This Part-Time Contract of Employment is entered into between [Company] and [Employee Full Name].',
      [
        { heading: 'Position and hours', body: 'The Employee is appointed as [job title] and will work [hours] per week on the following days: [days/times].' },
        { heading: 'Remuneration', body: 'The Employee will be paid [amount] per [hour/month], payable monthly in arrears.' },
        { heading: 'Pro-rata benefits', body: 'Leave and other benefits will accrue on a pro-rata basis in proportion to hours worked, in accordance with law and company policy.' },
      ],
      'Signed by the parties on the dates indicated below.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Confirmation of permanent employment',
      'Confirms successful completion of probation.',
      'We are pleased to confirm that, following the successful completion of your probationary period, your employment with [Company] is now confirmed as permanent.',
      [
        { heading: 'Confirmation', body: 'Your appointment as [job title] is confirmed with effect from [date]. All terms of your contract of employment continue to apply.' },
        { heading: 'Going forward', body: 'We look forward to your continued contribution and growth within the company.' },
      ],
      'Congratulations and welcome aboard on a permanent basis.\n\nYours sincerely,'
    ),
    T(
      'Internship agreement',
      'Fixed-term internship or learnership.',
      'This Internship Agreement is concluded between [Company] and [Intern Full Name] for the purpose of practical workplace experience.',
      [
        { heading: 'Purpose and duration', body: 'The internship runs from [start date] to [end date] and is intended to provide structured learning in [field/discipline].' },
        { heading: 'Stipend', body: 'The Intern will receive a monthly stipend of [amount]. This agreement does not constitute permanent employment.' },
        { heading: 'Supervision', body: 'The Intern will report to [mentor/supervisor] who will provide guidance and assess progress.' },
      ],
      'Accepted and agreed by both parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Independent contractor agreement',
      'Engagement of an independent contractor.',
      'This Agreement records the terms on which [Contractor Name] is engaged by [Company] as an independent contractor.',
      [
        { heading: 'Services', body: 'The Contractor will provide the following services: [describe scope and deliverables]. The Contractor is not an employee of the Company.' },
        { heading: 'Fees and invoicing', body: 'The Contractor will be paid [rate/fee], invoiced [frequency] and payable within [x] days. The Contractor is responsible for own tax obligations.' },
        { heading: 'Independence', body: 'The Contractor controls the manner in which the services are performed and may not bind the Company without written authority.' },
      ],
      'Signed by the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Casual / temporary contract',
      'Short-term or on-call engagement.',
      'This Temporary Contract is concluded between [Company] and [Employee Full Name] for casual or short-term work.',
      [
        { heading: 'Engagement', body: 'The Employee is engaged on a temporary basis to perform [duties] as and when required. Work is offered on an as-needed basis with no guarantee of ongoing hours.' },
        { heading: 'Remuneration', body: 'The Employee will be paid [rate] per [hour/day] for hours actually worked.' },
      ],
      'Accepted and agreed by both parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Contract renewal',
      'Renews an expiring fixed-term contract.',
      'We are pleased to offer you a renewal of your fixed-term contract of employment with [Company].',
      [
        { heading: 'Renewal terms', body: 'Your contract is renewed for the period [start date] to [end date], on the same terms save for [note any changes].' },
        { heading: 'No expectation of further renewal', body: 'This renewal does not create an expectation of further renewal or permanent employment.' },
      ],
      'Please sign below to accept the renewal.\n\nYours sincerely,'
    ),
    T(
      'Variation of contract',
      'Records agreed changes to existing terms.',
      'This letter records the agreed variation to your existing contract of employment with [Company].',
      [
        { heading: 'Changes agreed', body: 'With effect from [date], the following terms are varied: [describe changes, for example role, hours, remuneration or location].' },
        { heading: 'Other terms unchanged', body: 'All other terms and conditions of your employment remain in full force and effect.' },
      ],
      'Please sign below to confirm your agreement to these changes.\n\nYours sincerely,'
    ),
  ],
  supply_contract: [
    T(
      'Goods supply agreement',
      'Agreement to supply goods.',
      'This Supply Agreement is entered into between [Company] ("the Purchaser") and [Supplier Name] ("the Supplier") for the supply of the goods described below.',
      [
        { heading: 'Scope of supply', body: 'The Supplier shall supply [describe goods, specifications and quantities] in accordance with the agreed schedule and quality standards.' },
        { heading: 'Pricing and payment', body: 'Prices are as set out in [Annexure A]. Payment terms are [terms], payable within [x] days of a valid invoice.' },
        { heading: 'Delivery', body: 'Goods shall be delivered to [location] on [schedule]. Risk passes on delivery; ownership passes on full payment.' },
        { heading: 'Quality and warranties', body: 'The Supplier warrants that all goods are free from defects, fit for purpose and compliant with applicable standards and regulations.' },
        { heading: 'Term and termination', body: 'This agreement runs from [start] to [end] and may be terminated on [notice] written notice or for material breach not remedied within [x] days.' },
      ],
      'Signed by duly authorised representatives of the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Services supply agreement',
      'Agreement to supply services.',
      'This Agreement records the terms on which [Supplier Name] will provide services to [Company].',
      [
        { heading: 'Services', body: 'The Supplier shall render the following services: [describe services and deliverables].' },
        { heading: 'Service standards', body: 'Services shall be performed with reasonable skill and care and in accordance with the standards set out in [Annexure / SLA].' },
        { heading: 'Fees', body: 'Fees are [amount/rate], invoiced [frequency] and payable within [x] days.' },
        { heading: 'Term', body: 'This agreement commences on [date] and continues until terminated in accordance with the termination clause.' },
      ],
      'Agreed and accepted by the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Preferred supplier appointment',
      'Letter appointing a preferred supplier.',
      'We are pleased to confirm the appointment of [Supplier Name] as a preferred supplier to [Company].',
      [
        { heading: 'Scope of appointment', body: 'This appointment relates to the supply of [goods/services] on the terms set out in our master agreement dated [date].' },
        { heading: 'Expectations', body: 'As a preferred supplier you are expected to maintain agreed pricing, service levels, compliance and reporting requirements.' },
      ],
      'We look forward to a productive partnership.\n\nYours sincerely,'
    ),
    T(
      'Master supply agreement',
      'Umbrella agreement governing ongoing supply.',
      'This Master Supply Agreement governs all orders placed by [Company] with [Supplier Name] during the term of this agreement.',
      [
        { heading: 'Framework', body: 'Individual purchase orders issued under this agreement will incorporate these terms. In the event of conflict, this agreement prevails unless expressly varied in writing.' },
        { heading: 'Pricing mechanism', body: 'Prices are governed by [price list/Annexure] and may be adjusted only [frequency/conditions] on [notice] written notice.' },
        { heading: 'Term and review', body: 'This agreement runs for [term] and is subject to review on [frequency].' },
      ],
      'Signed by duly authorised representatives.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Framework purchase agreement',
      'Call-off agreement for recurring purchases.',
      'This Framework Agreement establishes the terms under which [Company] may place call-off orders with [Supplier Name].',
      [
        { heading: 'Call-off orders', body: 'The Company is not obliged to place any minimum volume. Each call-off order is a separate contract incorporating these terms.' },
        { heading: 'Lead times and pricing', body: 'Agreed lead times and pricing are set out in [Annexure] and apply to all call-off orders during the term.' },
      ],
      'Agreed and accepted by the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Exclusive supply agreement',
      'Grants exclusive supply rights.',
      'This Agreement appoints [Supplier Name] as the exclusive supplier of [goods/services] to [Company] on the terms below.',
      [
        { heading: 'Exclusivity', body: 'During the term, the Company will source [goods/services] exclusively from the Supplier, subject to the Supplier meeting agreed pricing, quality and availability.' },
        { heading: 'Conditions of exclusivity', body: 'Exclusivity is conditional upon the Supplier maintaining [service levels/pricing competitiveness]. Failure to do so entitles the Company to source elsewhere.' },
      ],
      'Signed by authorised representatives.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Consignment stock agreement',
      'Supplier holds stock on consignment.',
      'This Agreement sets out the terms on which [Supplier Name] will place stock on consignment at [Company] premises.',
      [
        { heading: 'Consignment stock', body: 'The Supplier will hold [describe goods] on consignment. Ownership remains with the Supplier until the goods are drawn down and used by the Company.' },
        { heading: 'Reconciliation and payment', body: 'Stock will be reconciled [frequency]. The Company will pay for goods consumed within [x] days of reconciliation.' },
      ],
      'Agreed by the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Supplier code of conduct',
      'Supplier ethics and compliance undertaking.',
      'This document records the standards of conduct expected of all suppliers to [Company].',
      [
        { heading: 'Ethical standards', body: 'The Supplier undertakes to conduct business lawfully and ethically, and to prohibit bribery, corruption and any form of forced or child labour.' },
        { heading: 'Compliance', body: 'The Supplier will comply with all applicable laws, including health and safety, environmental and labour legislation, and will permit reasonable audits.' },
      ],
      'Acknowledged and accepted on behalf of the Supplier.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Purchase order terms',
      'Standard terms attached to purchase orders.',
      'These terms apply to the purchase order issued by [Company] to [Supplier Name].',
      [
        { heading: 'Acceptance', body: 'Acceptance of this purchase order constitutes acceptance of these terms. Delivery must be made in full and on time to the address specified.' },
        { heading: 'Invoicing and payment', body: 'Invoices must quote the purchase order number and will be paid within [x] days of receipt of a valid invoice and acceptance of goods.' },
      ],
      'Issued on behalf of [Company].\n\nFor and on behalf of [Company]'
    ),
    T(
      'Distribution agreement',
      'Appoints a distributor for products.',
      'This Agreement appoints [Distributor Name] to distribute the products of [Company] within the territory described below.',
      [
        { heading: 'Appointment and territory', body: 'The Distributor is appointed to market and sell [products] within [territory] on a [non-exclusive/exclusive] basis.' },
        { heading: 'Obligations', body: 'The Distributor will use reasonable efforts to promote sales, maintain adequate stock and uphold the reputation of the brand.' },
      ],
      'Signed by the parties.\n\nFor and on behalf of [Company]'
    ),
  ],
  sla: [
    T(
      'Standard service level agreement',
      'General SLA with response and resolution targets.',
      'This Service Level Agreement ("SLA") forms part of the agreement between [Company] and [Service Provider] and defines the service levels to be maintained.',
      [
        { heading: 'Services covered', body: 'This SLA applies to the following services: [list services].' },
        { heading: 'Availability', body: 'The Service Provider shall maintain service availability of at least [xx.x]% measured monthly, excluding agreed maintenance windows.' },
        { heading: 'Response and resolution times', body: 'Incidents shall be prioritised as Critical, High, Medium and Low, with response times of [x] and resolution targets of [y] respectively.' },
        { heading: 'Reporting', body: 'The Service Provider shall provide [monthly] performance reports measured against the targets in this SLA.' },
        { heading: 'Remedies', body: 'Where service levels are not met, the following remedies apply: [service credits / escalation / penalties].' },
        { heading: 'Review', body: 'This SLA shall be reviewed [frequency] and may be amended by written agreement of both parties.' },
      ],
      'Accepted on behalf of the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'IT support SLA',
      'SLA tailored to IT / helpdesk support.',
      'This SLA sets out the support service levels provided by [Service Provider] to [Company] for IT systems and end-user support.',
      [
        { heading: 'Support hours', body: 'Support is available [hours/days]. After-hours support is available for Critical incidents only.' },
        { heading: 'Priority matrix', body: 'P1 (system down): respond [x] / resolve [y]. P2 (major): respond [x] / resolve [y]. P3 (minor): respond [x] / resolve [y].' },
        { heading: 'Escalation', body: 'Unresolved incidents are escalated to [role] after [time], and to [senior role] after [time].' },
      ],
      'Agreed by the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Logistics / fleet SLA',
      'SLA for transport and logistics services.',
      'This SLA governs the transport and logistics services provided by [Service Provider] to [Company].',
      [
        { heading: 'Service scope', body: 'Services include [collection, transport, delivery] across the routes set out in [Annexure].' },
        { heading: 'On-time performance', body: 'The Service Provider shall achieve an on-time delivery rate of at least [xx]% measured monthly.' },
        { heading: 'Compliance and safety', body: 'All vehicles and drivers shall comply with applicable road traffic, safety and licensing requirements at all times.' },
        { heading: 'Penalties and credits', body: 'Failure to meet agreed targets attracts [service credits/penalties] as set out in [Annexure].' },
      ],
      'Signed by authorised representatives.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Facilities maintenance SLA',
      'SLA for building and facilities upkeep.',
      'This SLA defines the facilities maintenance service levels provided by [Service Provider] to [Company].',
      [
        { heading: 'Scope', body: 'Services cover [planned maintenance, reactive repairs, statutory inspections] for the premises at [location].' },
        { heading: 'Response times', body: 'Emergency call-outs: respond within [x]. Urgent repairs: [x]. Routine requests: [x]. Planned maintenance follows the agreed schedule.' },
        { heading: 'Reporting', body: 'A monthly maintenance report will be provided detailing jobs completed, outstanding items and compliance status.' },
      ],
      'Accepted on behalf of the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Security services SLA',
      'SLA for guarding and security services.',
      'This SLA governs the security services provided by [Service Provider] to [Company].',
      [
        { heading: 'Service scope', body: 'Services include [manned guarding, access control, patrols, control room monitoring] at [site(s)].' },
        { heading: 'Standards', body: 'All officers will be PSIRA registered, in uniform, and deployed in agreed numbers and shifts. Posts may not be left unmanned.' },
        { heading: 'Incident reporting', body: 'All incidents will be reported within [x] and recorded in the occurrence book and monthly report.' },
      ],
      'Signed by authorised representatives.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Cleaning services SLA',
      'SLA for hygiene and cleaning services.',
      'This SLA sets out the cleaning and hygiene service levels provided by [Service Provider] to [Company].',
      [
        { heading: 'Scope and frequency', body: 'Services include [daily/periodic cleaning tasks] across [areas], performed to the agreed cleaning specification and frequency.' },
        { heading: 'Quality standards', body: 'Cleaning quality will be measured by [inspection score/checklist]. Areas falling below standard must be rectified within [x].' },
      ],
      'Agreed by the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Software / SaaS SLA',
      'SLA for a hosted software service.',
      'This SLA sets out the availability and support commitments for the [software/service] provided by [Service Provider] to [Company].',
      [
        { heading: 'Availability', body: 'The service will be available at least [xx.x]% per calendar month, excluding scheduled maintenance notified in advance.' },
        { heading: 'Support and priorities', body: 'Support requests are prioritised P1 to P4 with response times of [x] and target resolution of [y].' },
        { heading: 'Data and backups', body: 'Data is backed up [frequency] with a recovery point objective of [x] and recovery time objective of [y].' },
      ],
      'Accepted by the parties.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Internal operational level agreement',
      'OLA between internal departments.',
      'This Operational Level Agreement records the service levels agreed between [Department A] and [Department B] within [Company].',
      [
        { heading: 'Services', body: 'The supporting department will provide [services] to the receiving department within the agreed timeframes.' },
        { heading: 'Turnaround times', body: 'Standard requests will be actioned within [x] working days; urgent requests within [x].' },
      ],
      'Agreed by the respective department heads.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Call centre SLA',
      'SLA for customer contact centre services.',
      'This SLA defines the contact centre service levels provided by [Service Provider] to [Company].',
      [
        { heading: 'Service levels', body: '[xx]% of calls will be answered within [x] seconds. Average handling time and abandonment rate will be maintained within agreed thresholds.' },
        { heading: 'Quality', body: 'Calls will be monitored for quality, with a minimum quality score of [xx]% maintained.' },
      ],
      'Signed by authorised representatives.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Maintenance & repairs SLA',
      'SLA for equipment maintenance and repair.',
      'This SLA governs the maintenance and repair of [equipment/plant] provided by [Service Provider] to [Company].',
      [
        { heading: 'Planned maintenance', body: 'Planned maintenance will be carried out [frequency] in accordance with the maintenance schedule to minimise downtime.' },
        { heading: 'Breakdown response', body: 'On breakdown, the Service Provider will attend within [x] and restore the equipment to working order within [y], or provide a workaround.' },
      ],
      'Accepted on behalf of the parties.\n\nFor and on behalf of [Company]'
    ),
  ],
  letter_of_intent: [
    T(
      'Letter of intent to purchase',
      'Non-binding intent to purchase goods/services.',
      'This Letter of Intent sets out the preliminary understanding between [Company] and [Counterparty] regarding the proposed transaction described below.',
      [
        { heading: 'Proposed transaction', body: 'The parties intend to [describe the proposed purchase/transaction], subject to negotiation and conclusion of a definitive agreement.' },
        { heading: 'Indicative terms', body: 'The principal indicative terms are: [price, volume, timeline]. These terms are subject to due diligence and board approval.' },
        { heading: 'Non-binding', body: 'Save for the confidentiality and exclusivity provisions below, this letter is not legally binding and creates no obligation to conclude the transaction.' },
        { heading: 'Confidentiality and exclusivity', body: 'The parties shall keep the contents of this letter confidential and shall negotiate exclusively for a period of [x] days.' },
      ],
      'Kindly countersign to confirm your agreement with the intent expressed above.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent to award',
      'Intent to award a contract pending finalisation.',
      'We are writing to confirm our intent to award [contract/project] to [Counterparty], subject to the conditions below.',
      [
        { heading: 'Basis of intended award', body: 'Following our evaluation of your proposal dated [date], we intend to appoint you for [scope of work].' },
        { heading: 'Conditions', body: 'The award is conditional upon [finalisation of contract terms / compliance documentation / approvals].' },
      ],
      'This letter does not constitute a binding contract until a formal agreement is signed.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent to lease',
      'Intent to lease premises or equipment.',
      'This Letter of Intent records the proposed terms for the lease of [premises/equipment] between [Lessor] and [Lessee].',
      [
        { heading: 'Subject of lease', body: 'The proposed lease relates to [describe premises/equipment] situated at [location].' },
        { heading: 'Indicative terms', body: 'Indicative terms: rental of [amount] per [period], lease term of [duration], commencing [date].' },
        { heading: 'Subject to agreement', body: 'These terms are indicative and subject to a formal lease agreement and any required approvals.' },
      ],
      'Please indicate your acceptance by signing below.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent to invest',
      'Non-binding intent to invest in a venture.',
      'This Letter of Intent records the preliminary interest of [Company] in making an investment in [Target/Venture].',
      [
        { heading: 'Proposed investment', body: 'The Company is considering an investment of [amount] in exchange for [equity/instrument], subject to due diligence and definitive agreements.' },
        { heading: 'Conditions', body: 'Any investment is conditional upon satisfactory due diligence, board approval and regulatory clearance where required.' },
        { heading: 'Non-binding', body: 'Save for confidentiality and exclusivity, this letter is not binding and creates no obligation to invest.' },
      ],
      'Kindly countersign to confirm your agreement with the intent above.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent — joint venture',
      'Intent to form a joint venture.',
      'This Letter of Intent sets out the intention of [Party A] and [Party B] to explore the formation of a joint venture.',
      [
        { heading: 'Purpose', body: 'The parties intend to combine [resources/expertise] to pursue [opportunity], on terms to be set out in a definitive joint venture agreement.' },
        { heading: 'Contributions', body: 'It is envisaged that each party will contribute [describe contributions] and share profits and risks as later agreed.' },
      ],
      'Please countersign to confirm the shared intent.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent to acquire',
      'Intent to acquire a business or assets.',
      'This Letter of Intent expresses the interest of [Company] in acquiring [target business/assets].',
      [
        { heading: 'Proposed acquisition', body: 'The proposed transaction involves the acquisition of [shares/assets] for an indicative consideration of [amount], subject to due diligence.' },
        { heading: 'Process', body: 'The parties will negotiate in good faith toward a sale agreement. The Company requests exclusivity for [x] days.' },
        { heading: 'Non-binding', body: 'Except for the confidentiality and exclusivity provisions, this letter is not legally binding.' },
      ],
      'Kindly sign to confirm your agreement to proceed.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent to partner',
      'Intent to enter a commercial partnership.',
      'This Letter of Intent records the intention of [Party A] and [Party B] to enter into a commercial partnership.',
      [
        { heading: 'Scope of partnership', body: 'The parties intend to collaborate on [describe initiative], with roles and responsibilities to be defined in a formal agreement.' },
        { heading: 'Next steps', body: 'The parties will work toward a definitive agreement within [x] days and will keep discussions confidential.' },
      ],
      'Please countersign to confirm the intent to partner.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent to supply',
      'Supplier expresses intent to supply.',
      'This Letter of Intent confirms the intention of [Supplier] to supply [goods/services] to [Company].',
      [
        { heading: 'Proposed supply', body: 'The Supplier intends to supply [goods/services] at indicative pricing of [amount], subject to a formal supply agreement.' },
        { heading: 'Conditions', body: 'This intent is subject to agreement on volumes, pricing, lead times and quality requirements.' },
      ],
      'Kindly countersign to confirm the intent to supply.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent — employment',
      'Pre-offer intent to employ.',
      'This Letter of Intent confirms our intention to offer you employment, subject to the conditions below.',
      [
        { heading: 'Intended role', body: 'We intend to offer you the position of [job title] at an indicative remuneration of [amount], subject to finalisation of a formal offer.' },
        { heading: 'Conditions', body: 'A formal offer is subject to [reference checks/qualifications/medical] and final approval. This letter does not constitute a binding offer of employment.' },
      ],
      'Please sign to indicate your interest in proceeding.\n\nYours sincerely,'
    ),
    T(
      'Letter of intent to sublet',
      'Intent to sublet premises.',
      'This Letter of Intent records the proposed terms for subletting [premises] from [Tenant] to [Subtenant].',
      [
        { heading: 'Subject premises', body: 'The proposed sublease relates to [describe premises] situated at [location].' },
        { heading: 'Indicative terms', body: 'Indicative rental of [amount] per [period] for a term of [duration], subject to landlord consent and a formal sublease.' },
      ],
      'Please sign below to confirm your interest.\n\nYours sincerely,'
    ),
  ],
  promotion: [
    T(
      'Promotion confirmation',
      'Confirms a promotion and new terms.',
      'Congratulations! We are pleased to confirm your promotion to the position of [new job title] at [Company], effective [date].',
      [
        { heading: 'New role and reporting line', body: 'In your new role you will report to [manager] and be responsible for [summary of new responsibilities].' },
        { heading: 'Remuneration', body: 'Your remuneration will be adjusted to [amount] per [period] with effect from [date]. All other benefits remain as per your existing terms unless stated otherwise.' },
        { heading: 'Expectations', body: 'We are confident you will excel and continue to contribute to the success of the team.' },
      ],
      'Please sign below to accept the promotion and its associated terms.\n\nCongratulations once again.\n\nYours sincerely,'
    ),
    T(
      'Acting appointment',
      'Temporary acting role appointment.',
      'This letter confirms your appointment to act in the position of [acting role] from [start date] to [end date].',
      [
        { heading: 'Scope of acting role', body: 'During this period you will assume the responsibilities of [role], in addition to / in place of your current duties.' },
        { heading: 'Acting allowance', body: 'You will receive an acting allowance of [amount] per [period] for the duration of the appointment.' },
        { heading: 'Conclusion', body: 'The acting appointment ends automatically on [end date] unless extended in writing.' },
      ],
      'Please confirm your acceptance below.\n\nYours sincerely,'
    ),
    T(
      'Promotion on probation',
      'Promotion subject to a probation period.',
      'We are pleased to offer you a promotion to [new role], subject to a probationary period as set out below.',
      [
        { heading: 'Probation', body: 'The promotion is subject to a probationary period of [x] months, during which your performance in the new role will be assessed.' },
        { heading: 'Confirmation', body: 'Subject to satisfactory performance, the promotion will be confirmed on [date], with revised remuneration of [amount].' },
      ],
      'Kindly sign below to accept these terms.\n\nYours sincerely,'
    ),
    T(
      'Promotion with relocation',
      'Promotion that includes a change of location.',
      'Congratulations! We are pleased to promote you to [new role], a position based at [new location], effective [date].',
      [
        { heading: 'New role', body: 'In your new role you will report to [manager] and assume responsibility for [summary of responsibilities].' },
        { heading: 'Relocation', body: 'Your place of work will move to [location]. The company will provide the following relocation assistance: [describe support].' },
        { heading: 'Remuneration', body: 'Your remuneration will be adjusted to [amount] per [period] with effect from [date].' },
      ],
      'Please sign below to accept the promotion and relocation.\n\nCongratulations once again.\n\nYours sincerely,'
    ),
    T(
      'Lateral move / sideways promotion',
      'Move to a comparable role with growth.',
      'We are pleased to confirm your move to the position of [new role] at [Company], effective [date].',
      [
        { heading: 'New role', body: 'This move broadens your experience into [area]. You will report to [manager] and take on [responsibilities].' },
        { heading: 'Terms', body: 'Your remuneration and benefits remain [unchanged/as set out below]. All other terms of employment continue to apply.' },
      ],
      'Please sign below to confirm your acceptance.\n\nYours sincerely,'
    ),
    T(
      'Promotion to management',
      'Elevation into a management role.',
      'Congratulations! We are delighted to promote you into the management position of [new role], effective [date].',
      [
        { heading: 'Leadership responsibilities', body: 'You will lead the [team/department], with responsibility for [people, budget, performance and delivery].' },
        { heading: 'Remuneration and benefits', body: 'Your total remuneration will be adjusted to [amount] per [period], together with [management benefits, if any].' },
        { heading: 'Expectations', body: 'We are confident in your ability to lead and develop your team to achieve outstanding results.' },
      ],
      'Please sign below to accept this management appointment.\n\nCongratulations.\n\nYours sincerely,'
    ),
    T(
      'Salary increase confirmation',
      'Confirms an annual or merit increase.',
      'We are pleased to confirm an increase to your remuneration in recognition of your contribution.',
      [
        { heading: 'New remuneration', body: 'With effect from [date], your remuneration will increase to [amount] per [period]. This reflects [annual review/merit/market adjustment].' },
        { heading: 'Other terms', body: 'All other terms and conditions of your employment remain unchanged.' },
      ],
      'Thank you for your continued contribution.\n\nYours sincerely,'
    ),
    T(
      'Reclassification / regrade',
      'Confirms a change in job grade.',
      'This letter confirms the reclassification of your position following a job evaluation.',
      [
        { heading: 'Regrade', body: 'With effect from [date], your position of [role] is reclassified to grade [new grade]. This recognises the scope of your current responsibilities.' },
        { heading: 'Remuneration', body: 'Your remuneration will be adjusted to [amount] per [period] in line with the new grade.' },
      ],
      'Please sign below to acknowledge the reclassification.\n\nYours sincerely,'
    ),
    T(
      'Promotion confirmed after probation',
      'Confirms a promotion previously on probation.',
      'We are pleased to confirm that, following the successful completion of the probationary period in your new role, your promotion to [new role] is now confirmed.',
      [
        { heading: 'Confirmation', body: 'Your appointment to [new role] is confirmed with effect from [date], together with the revised remuneration previously advised.' },
        { heading: 'Going forward', body: 'We look forward to your continued success in this role.' },
      ],
      'Congratulations on the confirmation of your promotion.\n\nYours sincerely,'
    ),
    T(
      'Senior / executive appointment',
      'Appointment to a senior leadership role.',
      'It is with great pleasure that we confirm your appointment to the senior position of [executive role], effective [date].',
      [
        { heading: 'Mandate', body: 'In this role you will be accountable for [strategic mandate, function and results], reporting to [governance body/executive].' },
        { heading: 'Remuneration package', body: 'Your total remuneration package will be [amount] per [period], together with [executive benefits].' },
        { heading: 'Governance', body: 'Your appointment is subject to the company governance framework and any conditions set out in your executive contract.' },
      ],
      'Please sign below to accept this appointment.\n\nCongratulations.\n\nYours sincerely,'
    ),
  ],
  contractor_termination: [
    T(
      'Termination for convenience',
      'Ends a contract per the notice clause.',
      'This letter serves as formal notice of termination of the agreement between [Company] and [Contractor], dated [date].',
      [
        { heading: 'Notice of termination', body: 'In accordance with clause [x] of the agreement, we hereby give notice to terminate the agreement with effect from [termination date].' },
        { heading: 'Wind-down obligations', body: 'You are requested to [complete outstanding deliverables / hand over assets / submit final invoices] by [date].' },
        { heading: 'Final settlement', body: 'Final payment for services rendered up to the termination date will be processed in accordance with the agreement upon receipt of a valid final invoice.' },
      ],
      'We thank you for your services and wish you well.\n\nYours faithfully,'
    ),
    T(
      'Termination for breach',
      'Ends a contract due to material breach.',
      'This letter constitutes formal notice of termination of the agreement between [Company] and [Contractor] as a result of material breach.',
      [
        { heading: 'Breach', body: 'Despite our notice dated [date], you have failed to remedy the following breach: [describe breach]. This constitutes a material breach of the agreement.' },
        { heading: 'Termination', body: 'Accordingly, we terminate the agreement with immediate effect / with effect from [date], in terms of clause [x].' },
        { heading: 'Reservation of rights', body: 'The company reserves all rights and remedies available to it in law, including any claim for damages arising from the breach.' },
      ],
      'All company property and confidential information must be returned by [date].\n\nYours faithfully,'
    ),
    T(
      'Non-renewal notice',
      'Confirms a fixed-term contract will not be renewed.',
      'We write to confirm that the fixed-term agreement between [Company] and [Contractor] will not be renewed upon its expiry.',
      [
        { heading: 'Expiry', body: 'The agreement dated [date] expires on [end date] and will terminate automatically on that date in accordance with its terms.' },
        { heading: 'Hand-over', body: 'Please ensure all deliverables, assets and documentation are handed over by [date].' },
      ],
      'We appreciate your contribution during the term of the agreement.\n\nYours faithfully,'
    ),
    T(
      'Termination for non-performance',
      'Ends a contract due to poor performance.',
      'This letter serves as notice of termination of the agreement between [Company] and [Contractor] as a result of sustained underperformance.',
      [
        { heading: 'Performance shortfall', body: 'Despite [notices/meetings] on [dates], the agreed performance standards in respect of [deliverables/SLA] have not been met.' },
        { heading: 'Termination', body: 'Accordingly, the agreement is terminated in terms of clause [x] with effect from [termination date].' },
        { heading: 'Wind-down', body: 'Please complete [outstanding work/hand-over] and submit any final invoice by [date].' },
      ],
      'We thank you for the services rendered.\n\nYours faithfully,'
    ),
    T(
      'Termination — end of project',
      'Concludes a project-based engagement.',
      'This letter confirms that the agreement between [Company] and [Contractor] will conclude on completion of [project].',
      [
        { heading: 'Project completion', body: 'The project for which you were engaged is [complete/nearing completion]. The agreement will therefore conclude on [date].' },
        { heading: 'Final matters', body: 'Please ensure all deliverables, documentation and assets are handed over, and submit your final invoice by [date].' },
      ],
      'Thank you for your contribution to the success of the project.\n\nYours faithfully,'
    ),
    T(
      'Mutual termination',
      'Records a termination agreed by both parties.',
      'This letter records the mutual agreement of [Company] and [Contractor] to terminate the agreement dated [date].',
      [
        { heading: 'Mutual agreement', body: 'The parties have agreed to terminate the agreement with effect from [date] on amicable terms and with no admission of liability by either party.' },
        { heading: 'Settlement', body: 'Each party will [settle outstanding amounts/return property]. Save as recorded here, the parties have no further claims against each other.' },
      ],
      'Signed by both parties in confirmation of the mutual termination.\n\nFor and on behalf of [Company]'
    ),
    T(
      'Termination — insolvency',
      'Ends a contract on the counterparty becoming insolvent.',
      'This letter constitutes notice of termination of the agreement between [Company] and [Contractor] following an insolvency event.',
      [
        { heading: 'Insolvency event', body: 'We have become aware that [describe event, for example liquidation, business rescue or inability to pay debts]. This entitles the Company to terminate in terms of clause [x].' },
        { heading: 'Termination and rights', body: 'The agreement is terminated with immediate effect. The Company reserves all rights and remedies available to it in law.' },
      ],
      'All company property must be returned without delay.\n\nYours faithfully,'
    ),
    T(
      'Suspension pending investigation',
      'Suspends a contractor while a matter is investigated.',
      'This letter notifies you that the services under the agreement between [Company] and [Contractor] are suspended pending an investigation.',
      [
        { heading: 'Suspension', body: 'With effect from [date], the provision of services is suspended while the Company investigates [describe matter]. This is a precautionary measure and not a finding of wrongdoing.' },
        { heading: 'Cooperation', body: 'You are requested to cooperate with the investigation and to refrain from [relevant activity] during the suspension.' },
      ],
      'We will advise you of the outcome in due course.\n\nYours faithfully,'
    ),
    T(
      'Termination — health & safety',
      'Ends a contract for serious safety failures.',
      'This letter serves as notice of termination of the agreement between [Company] and [Contractor] arising from serious health and safety failures.',
      [
        { heading: 'Safety failures', body: 'The following serious safety breaches occurred: [describe incidents/dates]. These pose unacceptable risk to people and property.' },
        { heading: 'Termination', body: 'In the circumstances, the agreement is terminated in terms of clause [x] with effect from [date].' },
      ],
      'The Company reserves all its rights in this regard.\n\nYours faithfully,'
    ),
    T(
      'Immediate termination — material breach',
      'Summary termination for serious breach.',
      'This letter constitutes immediate termination of the agreement between [Company] and [Contractor] as a result of a serious and irremediable breach.',
      [
        { heading: 'Breach', body: 'You have committed the following serious breach: [describe]. Owing to its nature, the breach cannot be remedied and warrants immediate termination.' },
        { heading: 'Immediate effect', body: 'The agreement is terminated with immediate effect in terms of clause [x]. All company property and confidential information must be returned by [date].' },
      ],
      'The Company reserves all rights and remedies available to it.\n\nYours faithfully,'
    ),
  ],
  transfer: [
    T(
      'Internal transfer',
      'Transfer to another department or team.',
      'This letter confirms your transfer from [current department] to [new department] at [Company], effective [date].',
      [
        { heading: 'New role and reporting line', body: 'In your new department you will hold the position of [role] and report to [manager].' },
        { heading: 'Terms of employment', body: 'Your existing terms and conditions of employment remain unchanged unless specifically varied in this letter.' },
        { heading: 'Hand-over', body: 'Please complete a thorough hand-over of your current responsibilities to [name] before the effective date.' },
      ],
      'We wish you success in your new role.\n\nYours sincerely,'
    ),
    T(
      'Location / branch transfer',
      'Transfer to a different work location.',
      'This letter confirms your transfer to our [new location/branch], effective [date].',
      [
        { heading: 'New place of work', body: 'Your place of work will change to [address]. Your role and reporting line remain [unchanged / as follows].' },
        { heading: 'Relocation support', body: 'The company will provide the following relocation support: [describe assistance, if any].' },
      ],
      'Please sign below to acknowledge and accept the transfer.\n\nYours sincerely,'
    ),
    T(
      'Secondment',
      'Temporary secondment to another entity or site.',
      'This letter sets out the terms of your secondment to [host entity/site] for the period [start] to [end].',
      [
        { heading: 'Purpose and duration', body: 'You are seconded to [host] to [purpose]. The secondment runs from [start] to [end] and may be extended by written agreement.' },
        { heading: 'Terms during secondment', body: 'During the secondment you will report to [host manager]. Your home employment terms and benefits remain in force.' },
        { heading: 'Return', body: 'On conclusion of the secondment you will return to your substantive role at [home department].' },
      ],
      'Kindly sign to confirm your acceptance of the secondment terms.\n\nYours sincerely,'
    ),
    T(
      'Promotional transfer',
      'Transfer that includes a promotion.',
      'This letter confirms your transfer and promotion to [new role] in [new department], effective [date].',
      [
        { heading: 'New role and reporting line', body: 'You will hold the position of [role] and report to [manager], with responsibility for [summary].' },
        { heading: 'Remuneration', body: 'Your remuneration will be adjusted to [amount] per [period] with effect from [date].' },
      ],
      'Congratulations on your transfer and promotion. Please sign below to accept.\n\nYours sincerely,'
    ),
    T(
      'Transfer at employee request',
      'Approves a transfer requested by the employee.',
      'Further to your request, we are pleased to confirm your transfer from [current] to [new department/location], effective [date].',
      [
        { heading: 'Approved transfer', body: 'Your request to transfer has been approved. You will assume the position of [role] reporting to [manager].' },
        { heading: 'Terms', body: 'Your existing terms and conditions remain unchanged unless varied in this letter.' },
      ],
      'We wish you well in your new placement.\n\nYours sincerely,'
    ),
    T(
      'Restructure transfer',
      'Transfer arising from a reorganisation.',
      'As part of the recent restructuring of [department/function], this letter confirms your transfer to [new department], effective [date].',
      [
        { heading: 'Reason for transfer', body: 'Following the reorganisation, your role is being aligned to [new department]. You will report to [manager].' },
        { heading: 'Continuity of terms', body: 'Your service is continuous and your existing terms and conditions remain unchanged unless specifically varied.' },
      ],
      'Please sign below to acknowledge the transfer.\n\nYours sincerely,'
    ),
    T(
      'Inter-company transfer',
      'Transfer to a related entity within the group.',
      'This letter confirms your transfer from [Company A] to [Company B] within the group, effective [date].',
      [
        { heading: 'New employer', body: 'With effect from [date], your employment transfers to [Company B] in the role of [role], reporting to [manager].' },
        { heading: 'Continuity', body: 'Your length of service and accrued benefits will be recognised by the new entity. Existing terms continue unless varied here.' },
      ],
      'Please sign below to confirm your acceptance of the transfer.\n\nYours sincerely,'
    ),
    T(
      'Temporary redeployment',
      'Short-term move to meet operational needs.',
      'This letter confirms your temporary redeployment to [department/site] from [start] to [end].',
      [
        { heading: 'Redeployment', body: 'To meet operational requirements, you will temporarily perform the duties of [role] at [location] for the period stated.' },
        { heading: 'Return', body: 'On conclusion of the redeployment you will return to your substantive role. Your terms and conditions remain unchanged.' },
      ],
      'Please sign below to acknowledge the temporary redeployment.\n\nYours sincerely,'
    ),
    T(
      'Shift transfer',
      'Change of working shift or roster.',
      'This letter confirms a change to your working shift, effective [date].',
      [
        { heading: 'New shift', body: 'With effect from [date], you will work the [shift name] shift: [days/times]. This change is made to meet operational requirements.' },
        { heading: 'Other terms', body: 'Save for the change of shift, all other terms and conditions of your employment remain unchanged.' },
      ],
      'Please sign below to acknowledge the change of shift.\n\nYours sincerely,'
    ),
    T(
      'Transfer with new reporting line',
      'Change of manager or reporting structure.',
      'This letter confirms a change to your reporting line, effective [date].',
      [
        { heading: 'New reporting line', body: 'With effect from [date], you will report to [new manager], [title]. Your role and location remain [unchanged/as follows].' },
        { heading: 'Continuity', body: 'All other terms and conditions of your employment remain in force.' },
      ],
      'Please sign below to acknowledge the change.\n\nYours sincerely,'
    ),
  ],
  generic: [
    T(
      'Formal business letter',
      'A clean, general-purpose formal letter.',
      'I am writing to you regarding [subject of the letter].',
      [
        { heading: 'Background', body: '[Provide the relevant context or background to the matter.]' },
        { heading: 'Main message', body: '[Set out the main purpose of your letter clearly and concisely.]' },
        { heading: 'Next steps', body: '[State any action required, timelines, or how the recipient should respond.]' },
      ],
      'Thank you for your attention to this matter.\n\nYours faithfully,'
    ),
    T(
      'Letter of confirmation',
      'Confirms an arrangement or decision.',
      'This letter confirms [the arrangement/decision/agreement] reached on [date].',
      [
        { heading: 'What is confirmed', body: '[Clearly state what is being confirmed, including key dates, amounts or conditions.]' },
        { heading: 'Reliance', body: 'Please contact us should any of the above not accurately reflect your understanding.' },
      ],
      'We appreciate your cooperation.\n\nYours sincerely,'
    ),
    T(
      'Letter of appreciation',
      'Thanks a person or organisation.',
      'On behalf of [Company], I would like to express our sincere appreciation for [reason].',
      [
        { heading: 'Recognition', body: '[Describe specifically what you are grateful for and the impact it has had.]' },
      ],
      'Thank you once again.\n\nWith kind regards,'
    ),
    T(
      'Letter of demand',
      'Formal demand for payment or performance.',
      'This letter constitutes a formal demand in respect of [amount owing/obligation outstanding].',
      [
        { heading: 'Basis of demand', body: 'In terms of [agreement/invoice dated], you are obliged to [pay the sum of [amount] / perform [obligation]]. This remains outstanding despite [prior reminders].' },
        { heading: 'Demand', body: 'You are required to [make payment / perform] within [x] days of the date of this letter, failing which we will [take legal action / exercise our rights] without further notice.' },
        { heading: 'Reservation of rights', body: 'All our rights remain reserved, including the right to recover interest and costs.' },
      ],
      'We trust this matter will receive your urgent attention.\n\nYours faithfully,'
    ),
    T(
      'Letter of apology',
      'Apology to a customer or stakeholder.',
      'On behalf of [Company], please accept our sincere apology for [describe the issue].',
      [
        { heading: 'What went wrong', body: 'We acknowledge that [describe what happened and its impact on you]. This fell short of the standard you are entitled to expect from us.' },
        { heading: 'What we are doing', body: 'To put matters right, we have [describe corrective action and any goodwill gesture], and we are taking steps to prevent a recurrence.' },
      ],
      'We value your relationship with us and thank you for your understanding.\n\nYours sincerely,'
    ),
    T(
      'Notice / announcement',
      'General notice to staff or stakeholders.',
      'This notice is to inform you of [subject of the announcement].',
      [
        { heading: 'Details', body: 'Please be advised that [provide the key details, dates and any action required].' },
        { heading: 'Contact', body: 'Should you have any questions, please contact [name/department].' },
      ],
      'Thank you for your attention.\n\nYours sincerely,'
    ),
    T(
      'Reference / testimonial letter',
      'Confirms employment and provides a reference.',
      'This letter is provided at the request of [Name] and confirms the following in relation to their employment with [Company].',
      [
        { heading: 'Employment details', body: '[Name] was employed by [Company] as [job title] from [start date] to [end date].' },
        { heading: 'Conduct and performance', body: 'During this period, [Name] [describe performance, conduct and key strengths]. We are happy to recommend [Name] for future opportunities.' },
      ],
      'Please contact us should you require any further information.\n\nYours faithfully,'
    ),
    T(
      'Invitation to a meeting',
      'Formally invites a person to a meeting.',
      'You are hereby invited to attend a meeting regarding [subject].',
      [
        { heading: 'Meeting details', body: 'Date: [date]. Time: [time]. Venue: [venue/link]. The purpose of the meeting is to [state purpose].' },
        { heading: 'Preparation', body: 'Please bring [documents] and be prepared to discuss [agenda items]. You may be accompanied by [representative, where applicable].' },
      ],
      'Kindly confirm your attendance by [date].\n\nYours sincerely,'
    ),
    T(
      'Request for information',
      'Requests documents or information.',
      'We are writing to request the following information in relation to [matter].',
      [
        { heading: 'Information required', body: 'Kindly provide [list the specific documents or information required] by [date].' },
        { heading: 'Purpose', body: 'This information is required in order to [state reason]. The information will be treated in accordance with our privacy obligations.' },
      ],
      'Thank you for your cooperation.\n\nYours faithfully,'
    ),
    T(
      'Acknowledgement of receipt',
      'Confirms receipt of a document or item.',
      'This letter confirms that we have received [describe document/item] from you on [date].',
      [
        { heading: 'What was received', body: 'We acknowledge receipt of [describe], for which we thank you.' },
        { heading: 'Next steps', body: 'The matter is now [under review / being processed]. We will revert to you by [date] / as soon as [milestone].' },
      ],
      'Thank you for your correspondence.\n\nYours sincerely,'
    ),
  ],
};

/** Flatten the seeds into rows with a stable seed_key for idempotent insertion. */
export function buildSeedRows() {
  const rows = [];
  for (const [letter_type, templates] of Object.entries(LETTER_TEMPLATE_SEEDS)) {
    templates.forEach((tpl, idx) => {
      rows.push({
        letter_type,
        template_name: tpl.template_name,
        description: tpl.description,
        intro_body: tpl.intro_body,
        sections_json: JSON.stringify(tpl.sections || []),
        closing_text: tpl.closing_text,
        sort_order: idx,
        seed_key: `sys:${letter_type}:${idx}`,
      });
    });
  }
  return rows;
}
