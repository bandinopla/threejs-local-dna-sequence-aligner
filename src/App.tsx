
import { Canvas } from '@react-three/fiber'
import { seq1Data, seq2Data } from './MockData';
import { DNAAlignmentVisualizer2 } from './DNAAlignmentVisualizer2';
import { useControls } from 'leva'
import { useRef, useState } from 'react';
import { type AlignmentStats, type SequenceStats } from './Aligner';
import { Bloom, ChromaticAberration, EffectComposer, Scanline, Noise } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { NoiseEffect } from './NoiseEffect'; 
 

//nucleic acid sequence
function App() {

    const { turnOffPostProcessing } = useControls({
        turnOffPostProcessing: false
    })
    const [s1, setS1] = useState(seq1Data);
    const [s2, setS2] = useState(seq2Data);

    const [stats, setStats] = useState<AlignmentStats>();

    return (<>
        <Canvas>
            <ambientLight intensity={1} />

            <DNAAlignmentVisualizer2 onStats={setStats} fasta1={s1} fasta2={s2} />

            {
                !turnOffPostProcessing && <EffectComposer>
                <NoiseEffect />
                <Bloom luminanceThreshold={0.3} luminanceSmoothing={.2} height={300} />
                <ChromaticAberration
                    offset={[0.0005, 0.0005]} // color offset
                />
                <Scanline
                    blendFunction={BlendFunction.OVERLAY} // blend mode
                    density={1.85} // scanline density
                />
                <Noise opacity={0.1}/>
                
            </EffectComposer>
            }
            

        </Canvas>
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1, pointerEvents: 'none' }} className='legend'>
                
            {stats && <div style={{ pointerEvents: 'auto', maxWidth: 500, padding: 30 }} className="vt323-regular">

                <div>
                    Local Nucleotide Sequence Aligner by <a href="https://x.com/bandinopla" target='_blank'><strong>@Bandinopla</strong></a>
                    <br/>Using <a href="https://en.wikipedia.org/wiki/Smith%E2%80%93Waterman_algorithm" target='_blank'>Smith–Waterman algorithm</a>
                </div>

                <StrandStats num={1} stats={stats.sequence1} onChange={setS1} />
                <StrandStats num={2} stats={stats.sequence2} onChange={setS2} />
                <h1>Alignment's length: <strong>{stats.alignmentLength} bp</strong></h1>
                <h1>Match: <strong>{(stats.alignmentMatchPercent * 100).toFixed(1)}% </strong></h1>

                <div>
                    WHERE TO FIND FASTA FILES? <a href="https://www.ncbi.nlm.nih.gov/nuccore/" target='_blank'><strong>ncbi.nlm.nih.gov</strong></a>
                </div>

                <div style={{ marginTop:40}}> 
                    <a href="https://github.com/bandinopla/threejs-local-dna-sequence-aligner" style={{ fontSize:"2em" }}>&lt;/&gt; SOURCE</a>
                </div>

            </div>}

        </div>
    </>
    )
}
 

function StrandStats({ stats, num, onChange }: {
    stats: SequenceStats,
    num: number,
    onChange?: (text: string) => void
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = reader.result as string;
            const isFASTA = text.startsWith(">") && text.match(/[ACGTURYKMSWBDHVN]/i);
            if (isFASTA) {
                onChange?.(text);
            } else {
                alert("Invalid FASTA file.");
            }
        };
        reader.readAsText(file);
    };

    return (
        <div>
            <h2>Subject <strong>{num}</strong>: <strong>{stats.name}</strong></h2>
            <h3>( <strong>{stats.length} bp</strong> ) Start: <strong>{stats.start}</strong> | End: <strong>{stats.end}</strong></h3>
            <button onClick={() => fileInputRef.current?.click()}>Change subject (*.fasta)</button>
            <input
                type="file"
                accept=".fasta"
                ref={fileInputRef}
                onChange={handleFile}
                style={{ display: 'none' }}
            />
        </div>
    );
}


export default App;