import { IntelligenceService } from './intelligence_service';

export class InsightGeneratorService {
  private intelligence = new IntelligenceService();

  async generateStrategicInsights(limit = 5) {
    return this.intelligence.getStrategicInsights('all', limit);
  }
}
