import path from 'path';
import { readdir, readFile } from 'fs/promises';
import { glob } from 'glob';
import { parseFrontmatter } from '../utils/frontmatter.js';
import type { SkillSchema } from '../data/flowSessionRepository/types.js';

export type SkillFile = {
  path: string;
  content: string;
};

export type Skill = {
  location: string;
  name: string;
  description: string;
  runtime?: string;
  readSkillMd: () => Promise<string>;
  readContent: () => Promise<SkillFile[]>;
};

type SkillFrontmatter = {
  name: string;
  description: string;
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class Skills {
  private skillsDir: string;
  private isStarted: boolean = false;
  skills: Skill[] = [];
  skillsByNameMap: Map<string, Skill> = new Map<string, Skill>();
  skillRuntimeMap: Record<string, string> = {};
  skillsByRuntime: Map<string, Skill[]> = new Map();
  skillsWithoutRuntime: Skill[] = [];

  constructor(cwd: string = process.cwd()) {
    this.skillsDir = path.join(cwd, 'src/skills');
  }

  /**
   * Reads all files from a skill folder recursively, excluding SKILL.md
   */
  private createReadContentFn(skillLocation: string): () => Promise<SkillFile[]> {
    return async () => {
      // Find all files recursively in the skill folder
      const pattern = path.join(skillLocation, '**', '*');
      const files = await glob(pattern, {
        nodir: true,
        absolute: false,
        cwd: skillLocation,
      });

      // Filter out SKILL.md and read each file
      const fileContents = await Promise.all(
        files
          .filter((file) => path.basename(file) !== 'SKILL.md')
          .map(async (file) => {
            const absolutePath = path.join(skillLocation, file);
            const content = await readFile(absolutePath, 'utf-8');
            return {
              path: absolutePath,
              content,
            };
          }),
      );

      return fileContents;
    };
  }

  /**
   * Creates a function to read SKILL.md on demand
   */
  private createReadSkillMdFn(skillLocation: string): () => Promise<string> {
    return async () => {
      const skillMdPath = path.join(skillLocation, 'SKILL.md');
      return await readFile(skillMdPath, 'utf-8');
    };
  }

  /**
   * Loads the skill-runtime mapping from skill-runtimes.json
   */
  private async loadSkillRuntimeMap(): Promise<void> {
    try {
      const runtimeMapPath = path.join(this.skillsDir, 'skill-runtimes.json');
      const runtimeMapContent = await readFile(runtimeMapPath, 'utf-8');
      this.skillRuntimeMap = JSON.parse(runtimeMapContent);
    } catch (error) {
      console.warn('Failed to load skill-runtimes.json, skills will have no runtime mapping:', error);
      this.skillRuntimeMap = {};
    }
  }

  /**
   * Groups skills by their runtime
   */
  private groupSkillsByRuntime(): void {
    this.skillsByRuntime.clear();
    this.skillsWithoutRuntime = [];

    for (const skill of this.skills) {
      if (skill.runtime) {
        const runtimeSkills = this.skillsByRuntime.get(skill.runtime) || [];
        runtimeSkills.push(skill);
        this.skillsByRuntime.set(skill.runtime, runtimeSkills);
      } else {
        this.skillsWithoutRuntime.push(skill);
      }
    }
  }

  /**
   * Initializes and loads all skills
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      console.warn('Skills already started');
      return;
    }

    // Load skill-runtime mapping
    await this.loadSkillRuntimeMap();

    // Read all directories in the skills folder
    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    const skillDirs = entries.filter((entry) => entry.isDirectory());

    // Process each skill directory
    const skills = await Promise.all(
      skillDirs.map(async (dir) => {
        const skillLocation = path.join(this.skillsDir, dir.name);
        const skillMdPath = path.join(skillLocation, 'SKILL.md');

        try {
          // Read and parse SKILL.md to extract metadata only
          const skillMdContent = await readFile(skillMdPath, 'utf-8');
          const { frontmatter } = parseFrontmatter<SkillFrontmatter>(skillMdContent);

          // Validate required fields
          if (!frontmatter.name || !frontmatter.description) {
            console.warn(`Skill in ${dir.name} is missing name or description in SKILL.md frontmatter`);
            return null;
          }

          // Get runtime for this skill from the mapping
          const runtime = this.skillRuntimeMap[frontmatter.name];

          // Create the skill object with lazy loaders
          const skill: Skill = {
            location: skillLocation,
            name: frontmatter.name,
            description: frontmatter.description,
            runtime,
            readSkillMd: this.createReadSkillMdFn(skillLocation),
            readContent: this.createReadContentFn(skillLocation),
          };

          this.skillsByNameMap.set(skill.name, skill);

          return skill;
        } catch (error) {
          console.warn(`Failed to load skill from ${dir.name}:`, error);
          return null;
        }
      }),
    );

    // Filter out failed skills
    this.skills = skills.filter((skill): skill is Skill => skill !== null);

    // Group skills by runtime
    this.groupSkillsByRuntime();

    this.isStarted = true;

    console.log(`Skills started: ${this.skills.length} skills loaded`);
  }

  /**
   * Stops and cleans up resources
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      console.warn('Skills not started');
      return;
    }

    this.skills = [];
    this.isStarted = false;

    console.log('Skills stopped');
  }

  /**
   * Gets a skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skillsByNameMap.get(name);
  }

  /**
   * Gets all skills
   */
  getSkills(): Skill[] {
    return this.skills;
  }

  /**
   * Checks if skills are started
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Returns Skill[] for the given skill names, skipping unknown names.
   */
  getSlice(names: string[]): Skill[] {
    return names.filter((name) => this.skillsByNameMap.has(name)).map((name) => this.skillsByNameMap.get(name)!);
  }

  /**
   * Returns skills as XML. If skillNames is provided, only returns those skills.
   * Otherwise returns all skills.
   */
  getSkillsAsXml(skillNames?: string[]): string {
    if (!this.isStarted) {
      throw new Error('Skills not started. Call start() first.');
    }

    // Filter skills if skillNames is provided
    const skillsToReturn = skillNames ? this.skills.filter((skill) => skillNames.includes(skill.name)) : this.skills;

    if (skillsToReturn.length === 0) {
      return '';
    }

    const lines = ['<available_skills>'];

    for (const skill of skillsToReturn) {
      lines.push('  <skill>');
      lines.push(`    <name>${escapeXml(skill.name)}</name>`);
      lines.push(`    <description>${escapeXml(skill.description)}</description>`);
      lines.push(`    <location>${escapeXml(skill.location)}</location>`);
      if (skill.runtime) {
        lines.push(`    <runtime>${escapeXml(skill.runtime)}</runtime>`);
      }
      lines.push('  </skill>');
    }

    lines.push('</available_skills>');

    return lines.join('\n');
  }
}
