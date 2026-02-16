import { EntityRegistryService } from '../services/entity_registry_service';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('EntityRegistryService', () => {
  const service = new EntityRegistryService();

  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  it('creates an entity and retrieves it by name', async () => {
    const created = await service.createEntity({
      entityType: 'customer',
      canonicalName: 'Acme Corporation',
      description: 'Enterprise customer'
    });

    expect(created.id).toBeDefined();
    expect(created.canonical_name).toBe('Acme Corporation');

    const fetched = await service.findByName('Acme Corporation');
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
  });

  it('resolves an entity by alias', async () => {
    const created = await service.createEntity({
      entityType: 'customer',
      canonicalName: 'Contoso Ltd'
    });

    const aliasMatch = await service.findByAlias('contoso');
    expect(aliasMatch).not.toBeNull();
    expect(aliasMatch?.id).toBe(created.id);
  });
});
