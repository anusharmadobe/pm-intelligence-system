#!/usr/bin/env ts-node

/**
 * Final Comprehensive Weekly Wins Analysis
 * Analyzes all weekly status update thread replies with improved criteria
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

// All thread replies from weekly status update threads
const ALL_THREAD_REPLIES = [
  // Thread 1769052603.990089 (2026-01-22)
  {
    "user": "U0900H3NUUT", "ts": "1769055784.412839",
    "text": "Handed over the designs for:\n• Dynamic Tables\n• Associate UI (Content Editing, Rearranging content, Workflow )\nHad a discussion with Devs for stylesheet UIs, understood some gaps, working on them, where defining the creation journey of stylesheet.\n Working on Deck, defined the examples for each patterns including  AEM Forms & AEP AI Agent.",
    "user_profile": { "real_name": "Utkarsha Sharma", "display_name": "utkarshas" }
  },
  {
    "user": "U03HRQ036BD", "ts": "1769144888.924279",
    "text": "*Ruchita (leave on 16 Jan)*\n• *AEM Forms as a Cloud Service*\n    ◦ Migrating content from EXL to AEM Live for EDS documents\n    ◦ Worked on January release notes and early access features\n• *AEM Forms 6.5 LTS*\n    ◦ Worked with Bhumika on publishing Install Turnkey and Upgrade Turnkey PDFs\n• *AEM Forms 6.5*\n    ◦ Worked on Transaction Reporting on JEE (added note)\n• *Miscellaneous*\n    ◦ Defined goals for 2026 with Khushwant\n    ◦ Working on the SEO checklist\n    ◦ Working on the first draft PoC of Agent Draft (to be shared with Khushwant soon)",
    "user_profile": { "real_name": "Ruchita Srivastava", "display_name": "ruchitas" }
  },
  {
    "user": "WAM5KDYBZ", "ts": "1769162564.412539",
    "text": "• Shared the 2026 goals for the Forms Content Experience team with Anurag.\n• Preparing an overview deck of the AEM Forms Content Experience team's key activities in 2025 and plans for 2026 for leadership meetings. \t\n• Analysed AEM Forms brand visibility for \"Forms Builder\" intent. \n• Analysed \"DoR\" terminology for visibility and customer intent perspective.  This part of activity to rename *Feature and terminology* to match how customers search and describe problems.  \n• Preparing the January 2026 edition of the CAB Newsletter. \t\n• Incorporating customer feedback into Core Components content.\n• Discussed AI UX Patterns deck's outline with Utkarsha. She is developing the deck.",
    "user_profile": { "real_name": "Khushwant Singh", "display_name": "khsingh" }
  },
  // Thread 1768447804.701709 (2026-01-15)
  {
    "user": "U03HRQ036BD", "ts": "1768471641.702999",
    "text": "*Ruchita:*\n• Worked on:\n    ◦ Rule Editor – exposed the option for a complete response in the event payload (Ready to document)\n    ◦ Footnotes – enhancements to footnotes(Ready to document)\n    ◦ Defined goals for 2026 with Khushwant\n• Working on\n    ◦ Feedback to migrate content from EXL to AEM Live for EDS\n    ◦ Video for a text input format example (In Review)\n• Learning\n    ◦ Completed a course on SEO using the Ahrefs tool\n• Draft rewriting SEO Agent:\n    ◦ Discussed with Khushwant sir for the same",
    "user_profile": { "real_name": "Ruchita Srivastava", "display_name": "ruchitas" }
  },
  {
    "user": "U08HVLWG1UM", "ts": "1768542091.012549",
    "text": "*Worked on:*\n• Completed *Release Notes article* for _AEM Forms 6.5 LTS SP1_\n• Authored *3 Setup Guide articles*\n• Authored *2 Troubleshooting articles*\n• Updated *AEM Forms 6.5 LTS SP1 PDF guides*\n• Updated *Supported Platforms* and *Technical Requirements* articles for:\n_AEM Forms 6.5_\n_AEM Forms 6.5 LTS_\n• Discussed and aligned on *Goals for 2026*\n• Currently working on *reviewing and addressing comments* on _AEM Forms 6.5 LTS guides and documentation <@W4R4S9FS4>_ ",
    "user_profile": { "real_name": "Bhumika Yadav", "display_name": "bhumikay" }
  },
  {
    "user": "W010NNJV7S8", "ts": "1768549667.162799",
    "text": "*Chris - Week of Jan 12*\n\n*Interactive Communications*\n• Worked with Utkarsha to prepare mocks for style sheets\n• Validated Style sheets requirements and mocks with the Field team\n• Did feature grooming for Associate UI requirements around content editing\n• Worked with Engineering to enable IC features on AEM Showcase env\n• Evangelised IC Editor, Communication builder and Associate UI features to Forms SCs\n*Agentic Innovations*\n• Did feature grooming and planning with Engg for Communication Builder agent (Extracting master page from uploaded file)\n• Did feature grooming and planning with Engg for Discovery agent (Enabling metdata based filters, and communication artefacts)\n• Facilitated resource alignment for DA with Engg (Syama -> Darshan)\n• Worked with Engg to enable communication builder features on AEM Showcase env\n• Attended EPA scrum. Need to enable communication builder agent skills on AEM Trials\n*Customer conversations*\n• Had a detail rundown and clarification of requirements for IC and Associate UI with NFCU. Identified must haves to drive prioritisation with Engg.\n• Helped SC(Tano) for demo prep for MoD\n• Creating pipeline for DA (LPL and Jet2)\n*Demo Readiness*\n• Did a demo of Portal feature to Forms SCs\n• Enabled Forms Early Innovations on 'Presales and SC' segment\n• Followed up and collated list of SC details for enabling early innovation features.\n*Misc*\n• 15th Jan was a Holiday in Bangalore\n• Updated AEM GTM wiki for Jan releases of Forms\n• Mentoring IIMB Students for SPM course",
    "user_profile": { "real_name": "Chris J", "display_name": "macman" }
  },
  {
    "user": "U0900H3NUUT", "ts": "1768800003.076979",
    "text": "Week of Jan 12\n\nCreated mocks to stylesheet \n\nHad a discussion around the stylesheet mocks with devs \n\nHad a call with sufyan and team for Associate UI (Content editing, Rearranging component & Fragments replacement) Both author and associate flows.\n\nCreated mocks for Dynamic Table (IC)",
    "user_profile": { "real_name": "Utkarsha Sharma", "display_name": "utkarshas" }
  },
  // Thread 1765423807.893429 (2025-12-11)
  {
    "user": "U08HVLWG1UM", "ts": "1765468037.664089",
    "text": "Worked on: \n• Published all IC articles with updated images.\n• Updated 6.5.24.0 release article for release.\n• Working on IC feature article: Versioning, Copy and paste articles, will finish by Friday.\nNext week plan:\n• Will work on other IC feature article\n• Will work on IC video creation\n<@W4R4S9FS4> ",
    "user_profile": { "real_name": "Bhumika Yadav", "display_name": "bhumikay" }
  },
  {
    "user": "U03HRQ036BD", "ts": "1765516808.223769",
    "text": "*Ruchita:* \n*Worked on:*\n• Mostly occupied with the Garage Week demo for the Competitive Vocabulary Intelligence Agent\n• Added a custom policy for the Date Picker component (Video-pending)\n*Next week:*\n• Add a custom policy for the Numeric Core Component \n• Add Rule Editor enhancements\n• Coordinate with the engineering team for migration tool utility details\n",
    "user_profile": { "real_name": "Ruchita Srivastava", "display_name": "ruchitas" }
  },
  // Thread 1764819015.405709 (2025-12-04)
  {
    "user": "U08HVLWG1UM", "ts": "1764907114.698709",
    "text": "*Last Week – Completed Tasks*\n• Worked on the *Associate UI article* (content enhancement + restructuring).\n• Updated *images across Interactive Communication articles* for accuracy and clarity.\n• Updated the *AEM 6.5 LTS Hotfix article* with latest fixes and details.\n• Worked on *AEM 6.5 Release Notes*, including review and content updates.\n*Next Week – Planned Tasks*\n• Create new *Interactive Communication (IC) feature articles*, including:\n    ◦ _Copy-Paste for IC_\n    ◦ _Versioning for IC_\n    ◦ _Review and Approval Workflow for IC_\n• Start working on *IC tutorial videos* (planning, scripting, and recording).\n",
    "user_profile": { "real_name": "Bhumika Yadav", "display_name": "bhumikay" }
  },
  {
    "user": "U03HRQ036BD", "ts": "1764911247.116059",
    "text": "*Ruchita*\n*Last Week (2 weeks) :-*\n• Worked on and shared the following for the review:\n    ◦ Communication API article\n    ◦ JSON Web Token (JWT) Authentication article\n    ◦ OAuth Authentication article\n    ◦ Synchronous API tutorial steps\n• Written a blog on \"*The Silent Shift in How the Web is Read: Understanding the Rise of Agentic Access\" -* Shared for review with Khushwant\n*Next Week :-*\n •   Rule Editor enhancements\n •  Add a custom policy for the Date Picker and Numeric Core Components\n •   Hackathon (SEO project) — extracting keywords, performing competitive analysis, and rewriting the article for the selected keywords",
    "user_profile": { "real_name": "Ruchita Srivastava", "display_name": "ruchitas" }
  },
  // Thread 1758166219.357169 (2025-09-18) - "Your top wins"
  {
    "user": "U03HRQ036BD", "ts": "1758193537.922409",
    "text": "Ruchita:\n• Worked on migrating the content from EXL to aem.live for Universal Editor \n• Worked on the documentation of the Cloud Release September release\n",
    "user_profile": { "real_name": "Ruchita Srivastava", "display_name": "ruchitas" }
  },
  {
    "user": "WAM5KDYBZ", "ts": "1758289969.612309",
    "text": "• Delivered a joint AI Playground session with Anurag on \"Building with Cursor and MCP Servers,\" driving awareness and adoption.\n• Unblocked Adobe Consulting and UBS by authoring critical Rich Text documentation for Document of Record.",
    "user_profile": { "real_name": "Khushwant Singh", "display_name": "khsingh" }
  },
  // Thread 1756351821.576319 (2025-08-28) - "Your top wins"
  {
    "user": "U03HRQ036BD", "ts": "1756489763.311649",
    "text": "• Worked on the AEM Cloud Service August Release documentation.\n<https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/release-notes/release-notes/release-notes-current#forms>\n• *GA Features*\n    ◦ Error response from custom submit action service should override the cloud 5.x.x error page html. \n    ◦ Support of dorExclude disabled feature in core component based form\n    ◦ Date Time Input component \n    ◦ Mime type check on server - core-component \n• *Pre Release Feature*\n    ◦ AFP Support in Output sync\n    ◦ *Rule Editor Enhancements*\n        ▪︎ Allow validate method in function list to validate panel, field and form \n        ▪︎ Client-side custom function parsing to support ES10+ features and static imports \n        ▪︎ DownloadDor as OOTB function in rule editor\n        ▪︎ Support for Dynamic Variables in rules \n        ▪︎ Custom Event based rules support \n        ▪︎ Context based repeatable panel rules execution instead of last panel instance\n        ▪︎ Query/UTM/Browser Param based rules support \n        ▪︎ Form specific custom function script support in EDS\n• *Early Adopter Features*\n    ◦ API Integration in Rule Editor\n    ◦ Scribble Signature component",
    "user_profile": { "real_name": "Ruchita Srivastava", "display_name": "ruchitas" }
  },
  // Thread 1755747026.820749 (2025-08-21) - "Your top wins"
  {
    "user": "W4R4S9FS4", "ts": "1755800258.195599",
    "text": "Anurag\n• 2 new enrollments for Exp Builder EA: Lumen, Burnswick + Micron interested in evaluation.\n• LLMO deep dive to support customer conversations in APAC\n• Formalising VRA and Business growth programs for AEM with Prashant\n• Proposal for modernization discussed with Travel Port from 6.3 JEE to CS.\n• Providing guidance to simplify implementation of Soth African Police Service to expand Forms footprint and support renewal.",
    "user_profile": { "real_name": "Anurag Sharma", "display_name": "anusharm" }
  },
  {
    "user": "WAM5KDYBZ", "ts": "1755842930.326389",
    "text": "Khushwant\n\n• Contributed to research for to the AEM Forms vs Trustt battlecard, making it easier for sales teams to compare capabilities.\n• Delivered the draft Prompt Guide for Forms Experience Builder.  Our team is the first in AEM, and even across DX, to create such a resource. \n• Made a version of the Release Notes Generator Agent available for teams reporting to Vikas to try out. Thanks to Anurag for helping raise awareness across the India-based DX PM teams.",
    "user_profile": { "real_name": "Khushwant Singh", "display_name": "khsingh" }
  },
  {
    "user": "W010NNJV7S8", "ts": "1755846857.829469",
    "text": "Chris:\n• Pitched IC Editor to Deutshe bank, who are existing CM customer. They seem likely prospects atm\n• Discussed efficacy gains of IC Editor with NFCU, validating some hypothesis wrt the product\n• Worked with Utkarsha on grooming and defining certain mock requirements wrt IC Editor\n• Worked with Bhumika on closing some IC Editor doc requirements",
    "user_profile": { "real_name": "Chris J", "display_name": "macman" }
  },
  {
    "user": "U08HVLWG1UM", "ts": "1755848557.658729",
    "text": "• Worked on Jira ticket: <https://jira.corp.adobe.com/browse/CQDOC-22969|CQDOC-22969>\n• Reviewed IC articles with Khushwant and Chris\n• Finalized IC content for publishing\n• Working on Jira ticket: <https://jira.corp.adobe.com/browse/CQDOC-22962|CQDOC-22962>",
    "user_profile": { "real_name": "Bhumika Yadav", "display_name": "bhumikay" }
  },
  {
    "user": "U0900H3NUUT", "ts": "1755872343.137509",
    "text": "Jira tickets closed this week:\n•  Individual border Selection\n<https://jira.corp.adobe.com/browse/FORMS-21390>\n• Support for data.json in PDF Preview\n<https://jira.corp.adobe.com/browse/FORMS-21300>\nJira tickets work in progress this week:\n• Support for Custom Component: Dynamic Page <https://jira.corp.adobe.com/browse/FORMS-21297>\n• Page preset - design tweaks",
    "user_profile": { "real_name": "Utkarsha Sharma", "display_name": "utkarshas" }
  }
];

interface SlackMessage {
  text?: string;
  user?: string;
  ts: string;
  user_profile?: {
    real_name?: string;
    display_name?: string;
  };
  blocks?: any[];
  subtype?: string;
  [key: string]: any;
}

interface WeeklyWin {
  user: string;
  date: string;
  category: 'customer' | 'productivity' | 'business' | 'other';
  description: string;
  customerName?: string;
  quantifiable?: string;
  businessImpact?: string;
  confidence: 'high' | 'medium' | 'low';
}

function getMessageText(message: SlackMessage): string {
  if (message.text) return message.text;
  return '';
}

function extractCustomerName(text: string): string | undefined {
  // Enhanced customer name extraction with known customers
  const knownCustomers = [
    'NFCU', 'UBS', 'Deutshe bank', 'Deutsche Bank', 'Lumen', 'Burnswick', 
    'Micron', 'Travel Port', 'South African Police Service', 'MoD', 
    'LPL', 'Jet2', 'Adobe Consulting', 'Deutshe Bank'
  ];
  
  // Check for known customer names
  for (const customer of knownCustomers) {
    const pattern = new RegExp(`\\b${customer.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(text)) {
      return customer;
    }
  }
  
  // Pattern-based extraction
  const patterns = [
    /(?:with|for|to|at|unblocked|pitched|discussed|helped|providing\s+guidance\s+to)\s+(NFCU|UBS|Deutshe\s+[Bb]ank|Deutsche\s+[Bb]ank|Lumen|Burnswick|Micron|Travel\s+Port|South\s+African\s+Police\s+Service|MoD|LPL|Jet2|Adobe\s+Consulting)/i,
    /(NFCU|UBS|Deutshe\s+[Bb]ank|Deutsche\s+[Bb]ank|Lumen|Burnswick|Micron|Travel\s+Port|South\s+African\s+Police\s+Service|MoD|LPL|Jet2|Adobe\s+Consulting)\s+(?:customer|client|prospect|enrollment|evaluation|modernization|implementation|demo|conversation|SC)/i,
    /(?:enrollments?|evaluation|modernization|implementation|demo\s+prep)\s+(?:for|with)\s+(Lumen|Burnswick|Micron|Travel\s+Port|South\s+African\s+Police\s+Service|MoD)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Normalize
      if (name.toLowerCase().includes('deutshe') || name.toLowerCase().includes('deutsche')) {
        return 'Deutsche Bank';
      }
      if (name.toLowerCase().includes('mod')) {
        return 'MoD';
      }
      return name;
    }
  }
  
  return undefined;
}

function extractQuantifiableMetrics(text: string): { metrics: string; hasRealNumbers: boolean } {
  const realMetricPatterns = [
    /(\d+)\s*(?:new\s+)?(?:enrollments?|customers?|prospects?|evaluations?)\s*(?:for|in)/gi,
    /(\d+)\s*(?:Setup\s+Guide|Troubleshooting|articles?|pdfs?|guides?|features?|tickets?)\s*(?:published|created|authored|updated|completed|closed)/gi,
    /(\d+)\s*(?:hours?|days?|weeks?)\s*(?:saved|reduced|faster|improved)/gi,
    /(\d+)\s*(?:%|percent)\s*(?:increase|decrease|improvement|growth|reduction|savings|adoption)/gi,
    /(\$|USD)\s*(\d+[,\d]*)\s*(?:saved|revenue|cost|reduction|savings)/gi,
    /(\d+)\s*(?:x|times)\s*(?:faster|more|less|improvement|increase)/gi,
    /first\s+(?:in|across|team)/gi,
  ];
  
  const matches: string[] = [];
  let hasRealNumbers = false;
  
  realMetricPatterns.forEach(pattern => {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found);
      found.forEach(match => {
        const numMatch = match.match(/\d+/);
        if (numMatch) {
          const num = parseInt(numMatch[0]);
          if (num < 1900 || num > 2100 || match.includes('%') || match.includes('$') || match.includes('hours') || match.includes('days') || match.includes('x') || match.includes('times') || match.includes('first')) {
            hasRealNumbers = true;
          }
        }
      });
    }
  });
  
  return {
    metrics: matches.length > 0 ? matches.join(', ') : '',
    hasRealNumbers: hasRealNumbers
  };
}

function hasBusinessImpact(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  const impactKeywords = [
    'launched', 'deployed', 'shipped', 'released', 'delivered', 'completed',
    'achieved', 'exceeded', 'closed', 'signed', 'won', 'adopted',
    'published', 'migrated', 'handed over', 'shared', 'incorporated',
    'unblocked', 'pitched', 'enabled', 'finalized', 'authored', 'created',
    'enrollments', 'evaluation', 'modernization', 'renewal', 'prospects',
    'evangelised', 'validated', 'enabled'
  ];
  
  const routineKeywords = [
    'working on', 'preparing', 'discussing', 'planning', 'analyzing',
    'reviewing', 'drafting', 'defining', 'exploring', 'researching'
  ];
  
  const hasImpact = impactKeywords.some(kw => lowerText.includes(kw));
  const isRoutine = routineKeywords.some(kw => lowerText.includes(kw)) && !hasImpact;
  
  return hasImpact && !isRoutine;
}

function identifyWins(messages: SlackMessage[]): WeeklyWin[] {
  const wins: WeeklyWin[] = [];
  
  for (const message of messages) {
    if (message.subtype || message.user === 'USLACKBOT') {
      continue;
    }
    
    const text = getMessageText(message);
    if (!text || text.length < 30) {
      continue;
    }
    
    // Skip simple acknowledgments
    if (text.toLowerCase().match(/^(thanks|thank you|appreciate|good|nice|great|ok)$/i)) {
      continue;
    }
    
    const completionKeywords = [
      'launched', 'deployed', 'shipped', 'released', 'delivered', 'completed',
      'achieved', 'exceeded', 'closed', 'signed', 'won', 'adopted',
      'handed over', 'published', 'migrated', 'implemented', 'shared',
      'incorporated', 'worked on', 'prepared', 'created', 'built',
      'unblocked', 'pitched', 'enabled', 'finalized', 'authored',
      'enrollments', 'evaluation', 'modernization', 'renewal',
      'evangelised', 'validated'
    ];
    
    const hasCompletion = completionKeywords.some(kw => 
      text.toLowerCase().includes(kw)
    );
    
    if (!hasCompletion) {
      continue;
    }
    
    if (!hasBusinessImpact(text)) {
      continue;
    }
    
    const customerName = extractCustomerName(text);
    const metrics = extractQuantifiableMetrics(text);
    
    let confidence: 'high' | 'medium' | 'low' = 'low';
    
    if (customerName && metrics.hasRealNumbers) {
      confidence = 'high';
    } else if (customerName || metrics.hasRealNumbers) {
      confidence = 'medium';
    } else {
      if (hasCompletion && hasBusinessImpact(text)) {
        confidence = 'medium';
      } else {
        continue;
      }
    }
    
    if (confidence !== 'high' && confidence !== 'medium') {
      continue;
    }
    
    const userName = message.user_profile?.real_name || 
                    message.user_profile?.display_name || 
                    message.user || 
                    'Unknown';
    
    const date = new Date(parseFloat(message.ts) * 1000).toISOString().split('T')[0];
    
    wins.push({
      user: userName,
      date: date,
      category: customerName ? 'customer' : (metrics.hasRealNumbers ? 'business' : 'other'),
      description: text.substring(0, 600),
      customerName: customerName,
      quantifiable: metrics.metrics || undefined,
      businessImpact: metrics.hasRealNumbers ? metrics.metrics : undefined,
      confidence: confidence
    });
  }
  
  wins.sort((a, b) => {
    const order = { 'high': 3, 'medium': 2, 'low': 1 };
    if (order[b.confidence] !== order[a.confidence]) {
      return order[b.confidence] - order[a.confidence];
    }
    return b.date.localeCompare(a.date);
  });
  
  return wins;
}

function generateSummary(wins: WeeklyWin[]): string {
  const highConfidenceWins = wins.filter(w => w.confidence === 'high');
  const mediumConfidenceWins = wins.filter(w => w.confidence === 'medium');
  const customerWins = wins.filter(w => w.customerName);
  const quantifiedWins = wins.filter(w => w.quantifiable);
  
  let summary = `\n${'='.repeat(80)}\n`;
  summary += `📈 COMPREHENSIVE WEEKLY WINS ANALYSIS\n`;
  summary += `📋 From Weekly Status Update Thread Replies\n`;
  summary += `${'='.repeat(80)}\n\n`;
  
  summary += `📊 Summary Statistics:\n`;
  summary += `   Total Thread Replies Analyzed: ${ALL_THREAD_REPLIES.length}\n`;
  summary += `   Total Wins Identified: ${wins.length}\n`;
  summary += `   High Confidence Wins: ${highConfidenceWins.length}\n`;
  summary += `   Medium Confidence Wins: ${mediumConfidenceWins.length}\n`;
  summary += `   Wins with Customer Names: ${customerWins.length}\n`;
  summary += `   Wins with Quantifiable Metrics: ${quantifiedWins.length}\n\n`;
  
  if (highConfidenceWins.length > 0) {
    summary += `${'─'.repeat(80)}\n`;
    summary += `⭐ HIGH CONFIDENCE WINS (Customer Name + Quantifiable Metrics)\n`;
    summary += `${'─'.repeat(80)}\n\n`;
    highConfidenceWins.forEach((win, idx) => {
      summary += `${idx + 1}. ${win.user} (${win.date})\n`;
      if (win.customerName) {
        summary += `   👤 Customer: ${win.customerName}\n`;
      }
      if (win.quantifiable) {
        summary += `   📊 Metrics: ${win.quantifiable}\n`;
      }
      summary += `   ${win.description.substring(0, 500)}${win.description.length > 500 ? '...' : ''}\n\n`;
    });
  }
  
  if (mediumConfidenceWins.length > 0) {
    summary += `${'─'.repeat(80)}\n`;
    summary += `📋 MEDIUM CONFIDENCE WINS (Customer Name OR Quantifiable Metrics OR Clear Impact)\n`;
    summary += `${'─'.repeat(80)}\n\n`;
    
    // Group by customer wins first
    const customerMediumWins = mediumConfidenceWins.filter(w => w.customerName);
    const nonCustomerMediumWins = mediumConfidenceWins.filter(w => !w.customerName);
    
    if (customerMediumWins.length > 0) {
      summary += `\n🎯 Customer-Facing Wins:\n\n`;
      customerMediumWins.forEach((win, idx) => {
        summary += `${idx + 1}. ${win.user} (${win.date})\n`;
        summary += `   👤 Customer: ${win.customerName}\n`;
        if (win.quantifiable) {
          summary += `   📊 Metrics: ${win.quantifiable}\n`;
        }
        summary += `   ${win.description.substring(0, 400)}${win.description.length > 400 ? '...' : ''}\n\n`;
      });
    }
    
    if (nonCustomerMediumWins.length > 0) {
      summary += `\n📝 Other Significant Wins:\n\n`;
      nonCustomerMediumWins.forEach((win, idx) => {
        summary += `${idx + 1}. ${win.user} (${win.date})\n`;
        if (win.quantifiable) {
          summary += `   📊 Metrics: ${win.quantifiable}\n`;
        }
        summary += `   ${win.description.substring(0, 400)}${win.description.length > 400 ? '...' : ''}\n\n`;
      });
    }
  }
  
  if (wins.length === 0) {
    summary += `\n⚠️  No significant wins identified with improved criteria.\n\n`;
  }
  
  summary += `${'='.repeat(80)}\n`;
  
  return summary;
}

async function analyzeFinalWins() {
  console.log(`\n📊 Final Comprehensive Weekly Wins Analysis\n`);
  console.log(`Using Improved Criteria:\n`);
  console.log(`   ✅ Must have completion language`);
  console.log(`   ✅ Must have business impact`);
  console.log(`   ✅ Should include customer names OR quantifiable metrics\n`);
  
  try {
    console.log(`📥 Analyzing ${ALL_THREAD_REPLIES.length} thread replies from weekly status updates...\n`);
    
    const wins = identifyWins(ALL_THREAD_REPLIES as SlackMessage[]);
    
    const summary = generateSummary(wins);
    console.log(summary);
    
    const outputFile = join(process.cwd(), `final_weekly_wins_summary.txt`);
    writeFileSync(outputFile, summary, 'utf-8');
    console.log(`\n✅ Analysis saved to: ${outputFile}\n`);
    
    return { wins, summary };
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  analyzeFinalWins()
    .then(() => {
      console.log('✅ Analysis complete\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { analyzeFinalWins };
