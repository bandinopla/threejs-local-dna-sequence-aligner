export enum Result {
    NO_MATCH ,
    B_NOMATCH ,
    A_NOMATCH,
    GOOD_MATCH
}

export type ResidueResult = {
    iA:number 
    iB:number
    res:Result
}

export type Sequence = {
    name:string 
    sequence:string
}

export type SequenceStats = {
    name:string
    length:number 
    start:number
    end:number

}
export type AlignmentStats = {
    permutations:number 
    alignmentLength:number
    alignmentMatchPercent:number
    sequence1:SequenceStats
    sequence2:SequenceStats
}

/**
 * Aligns the provided Sequences...
 * @link https://en.wikipedia.org/wiki/Smith%E2%80%93Waterman_algorithm 
 */
export class Aligner {
    readonly alignment:ResidueResult[];
    readonly sequence1:Sequence;
    readonly sequence2:Sequence; 
    private _stats!:AlignmentStats;
    get stats(){ return this._stats; }

    constructor(fasta1: string, fasta2: string) {
        this.sequence1 = this.parseFasta(fasta1);
        this.sequence2 = this.parseFasta(fasta2); 

        this.alignment = this.analize( this.sequence1.sequence, this.sequence2.sequence ); 
    }

    get maxSequenceLength() {
        return Math.max( this.sequence1.sequence.length, this.sequence2.sequence.length);
    }

    /** 
     * @link https://en.wikipedia.org/wiki/Smith%E2%80%93Waterman_algorithm 
     * @param sequence1 
     * @param sequence2 
     */
    private analize( sequence1:string, sequence2:string )
    { 
        const W = (sequence1.length + 1);
        const H = (sequence2.length + 1)
        const permutationsTotal = W * H;

        const matchReward = 1;
        const mismatchPenalty = -matchReward;
        const gapPenalty = 1;

        const channels = 2; //0:score, 1:next index
        const permutations = new Float32Array(permutationsTotal * channels);

        let maxScore = 0;
        let maxIndex = 0;

        for (let i= 0; i < permutationsTotal; i++) {  
            const x = i % W;
            const y = Math.floor( i/W );

            if( y==0 || x==0 ) { 
                continue; // first row and columns must be all 0
            }

            const permScore = sequence1[x-1]==sequence2[y-1]? matchReward : mismatchPenalty;
            const iD = Math.floor((x-1) + (y-1)*W);
            const iL = Math.floor((x-1) + y*W);
            const iT = Math.floor(x + (y-1)*W);

            const myScore = permutations[iD*channels] + permScore;
            const lScore = permutations[iL*channels] - gapPenalty;
            const tScore = permutations[iT*channels] - gapPenalty;

            const score = Math.max(myScore, lScore, tScore, 0); 
            let nextIndex = 0;

            if( myScore==score )
            { 
                nextIndex = iD;
            }
            else if( score==lScore )
            {
                // stay on sequence 2, try the next residue of sequence 1...
                nextIndex = iL;
            }
            else if( score==tScore )
            {
                // stays on sequence 1, try the next residue of sequence 2...
                nextIndex = iT;
            }

            if( score>maxScore )
            {
                maxScore = score;
                maxIndex = i; 
            }

            permutations[i*channels] = score; 
            permutations[i*channels+1] = nextIndex; 
        } 

        //
        // ---- TRACEBACK ---- 
        //
        let next = maxIndex;
        const result:ResidueResult[] = []

        let iA = 0;
        let iB = 0;

        let gaps = 0;
        let matches = 0; 
        
        while( true )
        {  
            if( !next || next==0 || (permutations[ next * channels ] <= 0 )) break;
 
            const nextIndex = permutations[ next * channels + 1];
            const x = next % W;
            const y = Math.floor( next/W );

            const _iA = x-1;
            const _iB = y-1;
 
            const A = sequence1[_iA];
            const B = sequence2[_iB];

            let res = Result.GOOD_MATCH;

            if( A!=B )
            {  
                // here we are going from tail to head... so the "past" is actually the future. We are the future here...
                if( iA==_iA )
                { 
                    res = Result.B_NOMATCH;
                    gaps++;
                }
                else if( iB==_iB )
                {
                    res = Result.A_NOMATCH
                    gaps++;
                }
                else 
                {
                    res = Result.NO_MATCH;
                    // no gap, here we simply allowed these two to be next to each other even tho they dont match...
                }
            }
            else 
            {
                matches++;
            }
 
            result.push({
                iA: _iA,
                iB: _iB,
                res
            });

            iA = _iA;
            iB = _iB;
             
            next = nextIndex;   
        }

        //
        // stats
        //
        this._stats = {
            alignmentLength: result.length, // - gaps, (apparently gaps are considered)
            alignmentMatchPercent: matches/result.length,
            permutations: permutationsTotal, 
            sequence1: {
                name: this.sequence1.name, 
                length: this.sequence1.sequence.length,
                end: result[0].iA,
                start: result.at(-1)!.iA
            },
            sequence2: {
                name: this.sequence2.name, 
                length: this.sequence2.sequence.length,
                end: result[0].iB,
                start: result.at(-1)!.iB
            },
        }

        return result.reverse()
    }

    /**
     * @link https://en.wikipedia.org/wiki/FASTA_format
     * @param fasta 
     * @returns 
     */
    private parseFasta(fasta: string) :Sequence {
        const lines = fasta.split(/\r?\n/);
        let sequence = '';
        let name = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            if (line.startsWith('>')) {
                name = line;
                if (sequence.length > 0) break;
                continue; // skip header line
            }
            sequence += line;
        }

        return { name, sequence }
    }
}