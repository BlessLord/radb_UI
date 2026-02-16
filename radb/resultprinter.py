import io
from typing import override
import csv

class ResultPrinter():

    @classmethod
    def create(cls, outputformat):
        if outputformat == 'default':
            return DefaultResultPrinter()
        if outputformat == 'markdown':
            return MarkdownResultPrinter()
        if outputformat == 'org':
            return OrgResultPrinter()
        if outputformat == 'csv':
            return CSVResultPrinter()
        raise Exception(f"no result printer for {outputformat} exists!")

    @classmethod
    def getcolsizes(cls, r, attrs):
        colsizes = [0] * len(r[0])
        for i, v in enumerate(attrs):
            colsizes[i] = max(colsizes[i], len(str(v)))
        for row in r:
            for i, v in enumerate(row):
                colsizes[i] = max(colsizes[i], len(str(v)))
        return colsizes

    @classmethod
    def result_as_list(cls, r):
        return [ x for x in r ]

    def print(self, r, attrs):
        pass



class DefaultResultPrinter(ResultPrinter):

    @override
    def print(self,r,attrs):
        output = io.StringIO()
        output.write('({})\n'.format(', '.join(attrs)))
        if r.returns_rows:
            output.write('-'*70 + "\n")
            count = 0
            for row in r:
                output.write(', '.join(str(val) for val in row) + "\n")
                count += 1
            output.write('-'*70 + "\n")
            output.write('{} tuple{} returned\n'.format('no' if count == 0 else count,
                                                        '' if count == 1 else 's'))

        return output.getvalue()


class CSVResultPrinter(ResultPrinter):

    def formatonerow(self,row):
        return ','.join([str(val).strip() for val in row]) + '\n'

    @override
    def print(self,r, attrs):
        r = ResultPrinter.result_as_list(r)
        output = io.StringIO()
        csvwriter = csv.writer(output)
        # write header
        csvwriter.write(attrs)
        csvwriter(r)
        return output.getvalue()


class MarkdownResultPrinter(ResultPrinter):

    def formatonerow(self,row,colsizes):
        return '| ' + ' | '.join(str(val).ljust(colsizes[i]) for i,val in enumerate(row)) + ' |\n'

    def headersep(self,colsizes):
        return '|-' + '-|-'.join("".ljust(size, '-') for i,size in enumerate(colsizes)) + '-|\n'

    @override
    def print(self,r, attrs):
        r = ResultPrinter.result_as_list(r)
        colsizes = ResultPrinter.getcolsizes(r, attrs)
        output = io.StringIO()
        # write header
        output.write(self.formatonerow(attrs, colsizes))
        output.write(self.headersep(colsizes))
        count = 0
        for row in r:
            output.write(self.formatonerow(row, colsizes))
            count += 1
        return output.getvalue()

class OrgResultPrinter(ResultPrinter):

    def formatonerow(self,row,colsizes):
        return '| ' + ' | '.join(str(val).ljust(colsizes[i]) for i,val in enumerate(row)) + ' |\n'

    def headersep(self,colsizes):
        return '|-' + '-+-'.join("".ljust(size, '-') for i,size in enumerate(colsizes)) + '-|\n'

    @override
    def print(self,r,attrs):
        r = ResultPrinter.result_as_list(r)
        colsizes = ResultPrinter.getcolsizes(r,attrs)
        output = io.StringIO()
        # write header
        output.write(self.formatonerow(attrs, colsizes))
        output.write(self.headersep(colsizes))
        count = 0
        for row in r:
            output.write(self.formatonerow(row, colsizes))
            count += 1
        return output.getvalue()
